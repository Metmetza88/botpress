using System.Diagnostics;
using System.IO;
using System.Windows;

namespace BotPress;

public static class Program
{
    [STAThread]
    public static int Main(string[] args)
    {
        if (args.Contains("--selftest"))
        {
            using var o = new StreamWriter(Console.OpenStandardOutput(), new System.Text.UTF8Encoding(false)) { AutoFlush = true };
            return Monitor.SelfTest(o).GetAwaiter().GetResult();
        }
        // BotTeam and BotPress share one llama-server and one Rakazo (and their start/stop/revive loops): never both at once
        if (Process.GetProcessesByName("BotAdmin").Length > 0)
        {
            MessageBox.Show("BotTeam กำลังเปิดอยู่ — ปิด BotTeam ก่อนเปิด BotPress (ใช้ LLM และ Rakazo ชุดเดียวกัน)", "BotPress", MessageBoxButton.OK, MessageBoxImage.Warning);
            return 1;
        }
        // one window per profile: a second WebView2 on the same data dir would fight over it, and two hosts would double every Rakazo poll
        using var single = new Mutex(true, "BotPress.SingleInstance", out var first);
        if (!first)
        {
            MessageBox.Show("BotPress เปิดอยู่แล้ว", "BotPress", MessageBoxButton.OK, MessageBoxImage.Information);
            return 1;
        }
        // --devtools-port N: expose Chrome DevTools Protocol on 127.0.0.1:N for tests/*.mjs only
        int port = Array.IndexOf(args, "--devtools-port") is var i and >= 0 && i + 1 < args.Length ? int.Parse(args[i + 1]) : 0;
        return new Application().Run(new MainWindow(port));
    }
}
