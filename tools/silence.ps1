# Play pure digital silence (all-zero 16-bit stereo, 48 kHz) to the WinMM output device whose name contains
# -Match, for -Seconds. usage: silence.ps1 -Match 'Source/Sink' -Seconds 4
param([string]$Match = 'Source/Sink', [double]$Seconds = 4, [double]$Delay = 0)
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Threading;
public static class WinSil {
  [StructLayout(LayoutKind.Sequential)] public struct WAVEFORMATEX { public ushort wFormatTag; public ushort nChannels; public uint nSamplesPerSec; public uint nAvgBytesPerSec; public ushort nBlockAlign; public ushort wBitsPerSample; public ushort cbSize; }
  [StructLayout(LayoutKind.Sequential)] public struct WAVEHDR { public IntPtr lpData; public uint dwBufferLength; public uint dwBytesRecorded; public IntPtr dwUser; public uint dwFlags; public uint dwLoops; public IntPtr lpNext; public IntPtr reserved; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)] public struct WAVEOUTCAPS { public ushort wMid; public ushort wPid; public uint vDriverVersion; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string szPname; public uint dwFormats; public ushort wChannels; public ushort wReserved1; public uint dwSupport; }
  [DllImport("winmm.dll")] static extern uint waveOutGetNumDevs();
  [DllImport("winmm.dll", CharSet = CharSet.Auto)] static extern uint waveOutGetDevCaps(UIntPtr id, ref WAVEOUTCAPS caps, uint size);
  [DllImport("winmm.dll")] static extern uint waveOutOpen(out IntPtr h, uint dev, ref WAVEFORMATEX fmt, IntPtr cb, IntPtr inst, uint flags);
  [DllImport("winmm.dll")] static extern uint waveOutPrepareHeader(IntPtr h, IntPtr hdr, uint size);
  [DllImport("winmm.dll")] static extern uint waveOutUnprepareHeader(IntPtr h, IntPtr hdr, uint size);
  [DllImport("winmm.dll")] static extern uint waveOutWrite(IntPtr h, IntPtr hdr, uint size);
  [DllImport("winmm.dll")] static extern uint waveOutClose(IntPtr h);
  public static string Play(string match, double seconds) {
    int dev = -1; string name = null;
    for (int i = 0; i < waveOutGetNumDevs(); i++) {
      var c = new WAVEOUTCAPS(); waveOutGetDevCaps((UIntPtr)i, ref c, (uint)Marshal.SizeOf(c));
      if (c.szPname.Contains(match)) { dev = i; name = c.szPname; break; }
    }
    if (dev < 0) return "no output device matching " + match;
    var f = new WAVEFORMATEX { wFormatTag = 1, nChannels = 2, nSamplesPerSec = 48000, wBitsPerSample = 16, nBlockAlign = 4, nAvgBytesPerSec = 192000 };
    IntPtr h; uint r = waveOutOpen(out h, (uint)dev, ref f, IntPtr.Zero, IntPtr.Zero, 0);
    if (r != 0) return "waveOutOpen failed " + r;
    int bytes = (int)(seconds * 192000) & ~3;
    IntPtr data = Marshal.AllocHGlobal(bytes);
    for (int i = 0; i < bytes; i++) Marshal.WriteByte(data, i, 0);
    var hdr = new WAVEHDR { lpData = data, dwBufferLength = (uint)bytes };
    IntPtr ph = Marshal.AllocHGlobal(Marshal.SizeOf(hdr)); Marshal.StructureToPtr(hdr, ph, false);
    waveOutPrepareHeader(h, ph, (uint)Marshal.SizeOf(hdr));
    waveOutWrite(h, ph, (uint)Marshal.SizeOf(hdr));
    Thread.Sleep((int)(seconds * 1000) + 300);
    waveOutUnprepareHeader(h, ph, (uint)Marshal.SizeOf(hdr));
    waveOutClose(h);
    Marshal.FreeHGlobal(ph); Marshal.FreeHGlobal(data);
    return "played " + seconds + " s of silence to " + name + " (device " + dev + ")";
  }
}
'@
if ($Delay -gt 0) { Start-Sleep -Milliseconds ([int]($Delay * 1000)) }
"silence start $(Get-Date -Format HH:mm:ss.fff)"
[WinSil]::Play($Match, $Seconds)
"silence end $(Get-Date -Format HH:mm:ss.fff)"
