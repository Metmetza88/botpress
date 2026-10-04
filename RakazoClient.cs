using System.IO;
using System.Net;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace BotPress;

// Authenticated proxy to Rakazo's oRPC API (POST /rpc/<path>, body {"json": input}).
// "No login" for the user: a hidden owner account is created on first run; its password and the
// session cookie never leave this process. The page only gets JSON results.
static class RakazoClient
{
    const string Web = Monitor.RakazoUrl; // web origin also serves /rpc and /api/auth (and /novnc)
    const string Email = "owner@botpress.local";
    static readonly string CredFile = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "BotPress", "owner.json");
    // Node's keep-alive timeout is 5s; drop idle connections before that or a POST lands on a dead socket
    static readonly SocketsHttpHandler Handler = new()
    {
        CookieContainer = new CookieContainer(), UseCookies = true, PooledConnectionIdleTimeout = TimeSpan.FromSeconds(3),
    };
    static readonly HttpClient Http = new(Handler, false) { BaseAddress = new Uri(Web), Timeout = TimeSpan.FromSeconds(60) };
    static readonly HttpClient Streams = new(Handler, false) { BaseAddress = new Uri(Web), Timeout = Timeout.InfiniteTimeSpan };
    static readonly SemaphoreSlim Gate = new(1, 1);
    static bool _ready;

    // what the page may call; everything else (models, deployment, spaces, auth) stays host-only
    static readonly string[] Allowed = ["bootstrap", "me", "bots/", "botSections/", "approvalRules/", "groups/", "threads/", "computer/", "runs/list", "mcp/",
        "routines/", "memory/list", "memory/update", // memory provider connect/config (credentials) stays host-only
        "usage/list", "usage/summary", "search/query", "artifacts/list", "artifacts/get", "artifacts/create"];

    public static async Task<JsonNode?> Call(string path, JsonNode? input)
    {
        // '%' / '\': an encoded %2e%2e or backslash is decoded server-side into a host-only route
        if (!Allowed.Any(a => a.EndsWith('/') ? path.StartsWith(a) : path == a) || path.Contains("..") || path.Contains('%') || path.Contains('\\'))
            throw new InvalidOperationException("ไม่อนุญาต: " + path);
        await EnsureReady();
        return await Rpc(path, input);
    }

    // LLM mode = the account's default model; bots without their own model follow it. "local" = Gemma 4 on llama-server,
    // "synthetic" = a cloud model on Synthetic.new (subscription packs; a limit hit waits, see Rakazo's hotfix retry).
    // Both live in Rakazo's ONE openai-compatible credential (connect updates it in place), so every switch reconnects
    // with all fields. Rakazo's .env needs RAKAZO_OPENAI_COMPAT_ALLOW_PUBLIC=1, the model id in
    // RAKAZO_OPENAI_COMPATIBLE_VISION_MODELS (screenshots) and in RAKAZO_OPENAI_COMPATIBLE_CONTEXT_WINDOWS (its window).
    // "bcai" = BCAiRouter (D:\bcproxy, Windows :3399) through the socat bridge on docker0 :18399; it picks a provider per
    // request. Rakazo's hotfix sends it X-BCAiRouter-Guard: 0 (its default guard tells the model to ignore user/tool text).
    // The page only picks a mode; keys stay here.
    const string SyntheticUrl = "https://api.synthetic.new/openai/v1", SyntheticModel = "hf:zai-org/GLM-5.3-Flash";
    const string SyntheticKeyFile = Monitor.Root + @"\synthetic-api-key.txt";
    const string BcaiUrl = "http://172.17.0.1:18399/v1", BcaiModel = "bcai/tools";
    const string BcaiKeyFile = Monitor.Root + @"\bcai-api-key.txt";

    static string? FirstLine(string file) =>
        File.Exists(file) ? File.ReadLines(file).Select(l => l.Trim()).FirstOrDefault(l => l.Length > 0) : null;

    public static async Task<object> GetLlmMode()
    {
        await EnsureReady();
        var d = (await Rpc("models/credentials", null))!.AsArray().FirstOrDefault(c => c!["isDefault"]!.GetValue<bool>());
        var provider = d?["provider"]?.GetValue<string>() ?? "openai-compatible"; // an old deepseek default shows as no mode picked
        var url = d?["baseUrl"]?.GetValue<string>() ?? "";
        var mode = provider != "openai-compatible" ? provider : url.Contains("synthetic.new") ? "synthetic" : url.Contains(":18399") ? "bcai" : "local";
        return new { mode, model = d?["modelId"]?.GetValue<string>() ?? "" };
    }

    public static async Task<object> SetLlmMode(string mode)
    {
        await EnsureReady();
        if (mode == "local") await ConnectModel();
        else if (mode == "synthetic")
            await Rpc("models/connect", new JsonObject
            {
                ["provider"] = "openai-compatible", ["baseUrl"] = SyntheticUrl, ["modelId"] = SyntheticModel,
                ["apiKey"] = FirstLine(SyntheticKeyFile) ?? throw new InvalidOperationException("ไม่พบ Synthetic API key ใน " + SyntheticKeyFile),
                ["label"] = "GLM-5.3-Flash (Synthetic)", ["reasoning"] = false,
            });
        else if (mode == "bcai")
            await Rpc("models/connect", new JsonObject
            {
                ["provider"] = "openai-compatible", ["baseUrl"] = BcaiUrl, ["modelId"] = BcaiModel,
                ["apiKey"] = FirstLine(BcaiKeyFile) ?? "bcai-local", // a gateway without GATEWAY_API_KEY takes any Bearer
                ["label"] = "BCAiRouter", ["reasoning"] = false,
            });
        else throw new ArgumentException("mode ต้องเป็น local, synthetic หรือ bcai");
        var model = mode switch { "local" => "gemma4", "bcai" => BcaiModel, _ => SyntheticModel };
        await Rpc("models/setDefault", new JsonObject { ["provider"] = "openai-compatible", ["modelId"] = model });
        return await GetLlmMode();
    }

    public static async Task<CookieCollection> SessionCookies()
    {
        await EnsureReady();
        return Handler.CookieContainer.GetCookies(new Uri(Web));
    }

    static async Task<JsonNode?> Rpc(string path, JsonNode? input, bool retry = true)
    {
        using var res = await Http.PostAsync("/rpc/" + path, Body(new JsonObject { ["json"] = input?.DeepClone() }));
        var text = await res.Content.ReadAsStringAsync();
        if (res.StatusCode == HttpStatusCode.Unauthorized && retry)
        {
            _ready = false;
            await EnsureReady();
            return await Rpc(path, input, false);
        }
        JsonNode? body = null;
        try { if (text.Length > 0) body = JsonNode.Parse(text); }
        catch (JsonException) when (!res.IsSuccessStatusCode) { } // an unknown route answers plain text: report the status below
        catch (JsonException) { throw new InvalidOperationException($"Rakazo {(int)res.StatusCode}: {text[..Math.Min(80, text.Length)]}"); }
        if (!res.IsSuccessStatusCode)
            throw new InvalidOperationException(body?["json"]?["message"]?.GetValue<string>() ?? $"Rakazo {(int)res.StatusCode}");
        return body?["json"];
    }

    static StringContent Body(JsonNode node) => new(node.ToJsonString(), Encoding.UTF8, "application/json");

    // Sign in (or sign up the first time), then make sure the local model is connected.
    static async Task EnsureReady()
    {
        if (_ready) return;
        await Gate.WaitAsync();
        try
        {
            if (_ready) return;
            var cred = LoadOrCreatePassword();
            // sign up whenever sign-in fails, not only on the first run: owner.json is written before the account exists, so a first
            // launch that met a Rakazo still booting would stay locked out for good. Sign-up of an existing email is rejected (422)
            if (!await Auth("sign-in/email", new JsonObject { ["email"] = Email, ["password"] = cred })
                && !await Auth("sign-up/email", new JsonObject { ["name"] = "BotPress", ["email"] = Email, ["password"] = cred }))
                throw new InvalidOperationException("ล็อกอิน Rakazo ไม่ได้ (Rakazo ยังไม่พร้อม หรือบัญชีเจ้าของใน owner.json ไม่ตรงกับฐานข้อมูล)");
            var me = await Rpc("me", null, false);
            if (me?["needsModel"]?.GetValue<bool>() == true) await ConnectModel();
            _ready = true;
        }
        finally { Gate.Release(); }
    }

    static async Task<bool> Auth(string endpoint, JsonObject body)
    {
        using var req = new HttpRequestMessage(HttpMethod.Post, "/api/auth/" + endpoint) { Content = Body(body) };
        req.Headers.Add("Origin", Web); // better-auth checks Origin once a cookie is present
        using var res = await Http.SendAsync(req);
        return res.IsSuccessStatusCode;
    }

    static string LoadOrCreatePassword()
    {
        if (File.Exists(CredFile)) return JsonNode.Parse(File.ReadAllText(CredFile))!["password"]!.GetValue<string>();
        // ponytail: plain file under the user's %LOCALAPPDATA% (user-only ACL); DPAPI if the machine is shared
        var password = Convert.ToHexString(RandomNumberGenerator.GetBytes(24));
        Directory.CreateDirectory(Path.GetDirectoryName(CredFile)!);
        File.WriteAllText(CredFile, new JsonObject { ["email"] = Email, ["password"] = password }.ToJsonString());
        return password;
    }

    static async Task ConnectModel()
    {
        var key = File.ReadLines(Path.Combine(Monitor.Root, "llm-api-key.txt"))
            .Select(l => l.Trim()).FirstOrDefault(l => l.StartsWith("rakazo-"))
            ?? throw new InvalidOperationException("ไม่พบคีย์ rakazo- ใน llm-api-key.txt");
        await Rpc("models/connect", new JsonObject
        {
            ["provider"] = "openai-compatible",
            ["baseUrl"] = "http://172.17.0.1:18080/v1", // socat bridge on docker0 -> Windows llama-server
            ["modelId"] = "gemma4",
            ["apiKey"] = key,
            ["label"] = "Gemma 4 (เครื่องนี้)",
            ["reasoning"] = false,
        }, false);
    }

    // threads.subscribe as SSE; reconnects from the last seen seq until cancelled.
    public static async Task Subscribe(JsonObject target, long cursor, Action<JsonNode> onEvent, CancellationToken ct)
    {
        await EnsureReady();
        var delay = 250;
        while (!ct.IsCancellationRequested)
        {
            try
            {
                var input = (JsonObject)target.DeepClone();
                input["cursor"] = cursor;
                using var req = new HttpRequestMessage(HttpMethod.Post, "/rpc/threads/subscribe") { Content = Body(new JsonObject { ["json"] = input }) };
                using var res = await Streams.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, ct);
                if (res.StatusCode == HttpStatusCode.Unauthorized) { _ready = false; await EnsureReady(); continue; }
                res.EnsureSuccessStatusCode();
                using var reader = new StreamReader(await res.Content.ReadAsStreamAsync(ct));
                string? line, ev = null;
                while ((line = await reader.ReadLineAsync(ct)) != null)
                {
                    if (line.StartsWith("event: ")) ev = line[7..];
                    else if (line.StartsWith("data: ") && ev == "message")
                    {
                        var e = JsonNode.Parse(line[6..])?["json"];
                        if (e == null) continue;
                        cursor = Math.Max(cursor, e["seq"]?.GetValue<long>() ?? cursor);
                        onEvent(e);
                        delay = 250;
                    }
                    else if (line.StartsWith("data: ") && ev == "error")
                        throw new InvalidOperationException(JsonNode.Parse(line[6..])?["json"]?["message"]?.GetValue<string>() ?? "stream error");
                }
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested) { return; }
            catch (Exception) when (!ct.IsCancellationRequested) { /* API restart / network blip: back off and resume from cursor */ }
            await Task.Delay(delay, ct).ContinueWith(_ => { });
            delay = Math.Min(delay * 2, 5000);
        }
    }
}
