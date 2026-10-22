# Record from a WinMM input device to a 16-bit stereo 48 kHz WAV.
# usage: record.ps1 -Device 0 -Seconds 5 -Out file.wav
param([int]$Device = 0, [double]$Seconds = 5, [string]$Out)
$src = @'
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
public static class WinRec {
  [StructLayout(LayoutKind.Sequential)] public struct WAVEFORMATEX { public ushort wFormatTag; public ushort nChannels; public uint nSamplesPerSec; public uint nAvgBytesPerSec; public ushort nBlockAlign; public ushort wBitsPerSample; public ushort cbSize; }
  [StructLayout(LayoutKind.Sequential)] public struct WAVEHDR { public IntPtr lpData; public uint dwBufferLength; public uint dwBytesRecorded; public IntPtr dwUser; public uint dwFlags; public uint dwLoops; public IntPtr lpNext; public IntPtr reserved; }
  [DllImport("winmm.dll")] static extern uint waveInOpen(out IntPtr h, uint dev, ref WAVEFORMATEX fmt, IntPtr cb, IntPtr inst, uint flags);
  [DllImport("winmm.dll")] static extern uint waveInPrepareHeader(IntPtr h, IntPtr hdr, uint size);
  [DllImport("winmm.dll")] static extern uint waveInUnprepareHeader(IntPtr h, IntPtr hdr, uint size);
  [DllImport("winmm.dll")] static extern uint waveInAddBuffer(IntPtr h, IntPtr hdr, uint size);
  [DllImport("winmm.dll")] static extern uint waveInStart(IntPtr h);
  [DllImport("winmm.dll")] static extern uint waveInReset(IntPtr h);
  [DllImport("winmm.dll")] static extern uint waveInClose(IntPtr h);
  public static string Record(uint dev, double seconds, string path) {
    var f = new WAVEFORMATEX { wFormatTag = 1, nChannels = 2, nSamplesPerSec = 48000, wBitsPerSample = 16, nBlockAlign = 4, nAvgBytesPerSec = 192000, cbSize = 0 };
    IntPtr h; uint r = waveInOpen(out h, dev, ref f, IntPtr.Zero, IntPtr.Zero, 0);
    if (r != 0) return "open failed " + r;
    int len = (int)(seconds * 192000) & ~3;
    IntPtr buf = Marshal.AllocHGlobal(len);
    var hdr = new WAVEHDR { lpData = buf, dwBufferLength = (uint)len };
    int hs = Marshal.SizeOf(typeof(WAVEHDR));
    IntPtr ph = Marshal.AllocHGlobal(hs);
    Marshal.StructureToPtr(hdr, ph, false);
    waveInPrepareHeader(h, ph, (uint)hs);
    waveInAddBuffer(h, ph, (uint)hs);
    waveInStart(h);
    var t0 = DateTime.Now;
    while (true) {
      var cur = (WAVEHDR)Marshal.PtrToStructure(ph, typeof(WAVEHDR));
      if ((cur.dwFlags & 1) != 0 || (DateTime.Now - t0).TotalSeconds > seconds + 3) break;
      Thread.Sleep(20);
    }
    waveInReset(h);
    var done = (WAVEHDR)Marshal.PtrToStructure(ph, typeof(WAVEHDR));
    waveInUnprepareHeader(h, ph, (uint)hs);
    var data = new byte[done.dwBytesRecorded];
    Marshal.Copy(buf, data, 0, data.Length);
    waveInClose(h);
    Marshal.FreeHGlobal(buf); Marshal.FreeHGlobal(ph);
    using (var w = new BinaryWriter(File.Create(path))) {
      w.Write(new char[] { 'R', 'I', 'F', 'F' }); w.Write(36 + data.Length); w.Write(new char[] { 'W', 'A', 'V', 'E', 'f', 'm', 't', ' ' });
      w.Write(16); w.Write((short)1); w.Write((short)2); w.Write(48000); w.Write(192000); w.Write((short)4); w.Write((short)16);
      w.Write(new char[] { 'd', 'a', 't', 'a' }); w.Write(data.Length); w.Write(data);
    }
    return "ok " + data.Length + " bytes";
  }
}
'@
if (-not ('WinRec' -as [type])) { Add-Type -TypeDefinition $src }
[WinRec]::Record([uint32]$Device, $Seconds, $Out)
