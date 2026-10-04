using System.Diagnostics;
using System.IO;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace BotPress;

// Host side of the news board: reads the stories.json that the newsdesk MCP server (newsdesk/server.mjs, in its own
// container) keeps up to date, and opens the news folder. Read-only here; bots change stories only through the MCP tools.
public static class Newsdesk
{
    public const string NewsDir = @"D:\botpress\news";
    const string StoriesFile = NewsDir + @"\stories.json";

    public static JsonNode List()
    {
        string text;
        try
        {
            // the server writes tmp + rename: Delete sharing lets that rename replace the file while we read it
            using var fs = new FileStream(StoriesFile, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            text = new StreamReader(fs).ReadToEnd();
        }
        catch (Exception e) when (e is FileNotFoundException or DirectoryNotFoundException)
        {
            return new JsonObject { ["seq"] = new JsonObject(), ["stories"] = new JsonArray() }; // nothing pitched yet
        }
        try { if (JsonNode.Parse(text) is JsonObject o && o["stories"] is JsonArray) return o; }
        catch (JsonException) { }
        throw new InvalidOperationException("อ่านไฟล์ข่าว stories.json ไม่ได้ (รูปแบบไม่ถูกต้อง) — ลองเปิดโฟลเดอร์ข่าวเพื่อตรวจไฟล์");
    }

    public static void Folder()
    {
        Directory.CreateDirectory(NewsDir);
        Process.Start(new ProcessStartInfo("explorer.exe", $"\"{NewsDir}\"") { UseShellExecute = true });
    }
}
