# Record every channel of a WinMM input device (WAVE_FORMAT_EXTENSIBLE, 16-bit, 48 kHz) to a multichannel WAV.
# usage: record10.ps1 -Device 0 -Channels 10 -Seconds 5 -Mask 0 -Out file.wav
param([int]$Device = 0, [int]$Channels = 10, [double]$Seconds = 5, [uint32]$Mask = 0, [string]$Out)
$src = @'
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
public static class WinRec10 {
  [StructLayout(LayoutKind.Sequential, Pack = 1)] public struct WFX {
    public ushort wFormatTag; public ushort nChannels; public uint nSamplesPerSec; public uint nAvgBytesPerSec; public ushort nBlockAlign; public ushort wBitsPerSample; public ushort cbSize;
    public ushort wValidBitsPerSample; public uint dwChannelMask; public Guid SubFormat; }
  [StructLayout(LayoutKind.Sequential)] public struct WAVEHDR { public IntPtr lpData; public uint dwBufferLength; public uint dwBytesRecorded; public IntPtr dwUser; public uint dwFlags; public uint dwLoops; public IntPtr lpNext; public IntPtr reserved; }
  [DllImport("winmm.dll")] static extern uint waveInOpen(out IntPtr h, uint dev, ref WFX fmt, IntPtr cb, IntPtr inst, uint flags);
  [DllImport("winmm.dll")] static extern uint waveInPrepareHeader(IntPtr h, IntPtr hdr, uint size);
  [DllImport("winmm.dll")] static extern uint waveInUnprepareHeader(IntPtr h, IntPtr hdr, uint size);
  [DllImport("winmm.dll")] static extern uint waveInAddBuffer(IntPtr h, IntPtr hdr, uint size);
  [DllImport("winmm.dll")] static extern uint waveInStart(IntPtr h);
  [DllImport("winmm.dll")] static extern uint waveInReset(IntPtr h);
  [DllImport("winmm.dll")] static extern uint waveInClose(IntPtr h);
  public static string Record(uint dev, int ch, double seconds, uint mask, string path) {
    int block = ch * 2, rate = 48000 * block;
    var f = new WFX { wFormatTag = 0xFFFE, nChannels = (ushort)ch, nSamplesPerSec = 48000, wBitsPerSample = 16, nBlockAlign = (ushort)block, nAvgBytesPerSec = (uint)rate, cbSize = 22,
      wValidBitsPerSample = 16, dwChannelMask = mask, SubFormat = new Guid("00000001-0000-0010-8000-00aa00389b71") };
    IntPtr h; uint r = waveInOpen(out h, dev, ref f, IntPtr.Zero, IntPtr.Zero, 0);
    if (r != 0) return "open failed " + r;
    int len = ((int)(seconds * rate) / block) * block;
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
      w.Write(16); w.Write((short)1); w.Write((short)ch); w.Write(48000); w.Write(rate); w.Write((short)block); w.Write((short)16);
      w.Write(new char[] { 'd', 'a', 't', 'a' }); w.Write(data.Length); w.Write(data);
    }
    return "ok " + data.Length + " bytes, " + ch + " channels";
  }
}
'@
if (-not ('WinRec10' -as [type])) { Add-Type -TypeDefinition $src }
[WinRec10]::Record([uint32]$Device, $Channels, $Seconds, $Mask, $Out)
