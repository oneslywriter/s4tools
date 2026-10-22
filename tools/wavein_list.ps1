# Read-only: list the WinMM input devices (index, name, channels) for record10.ps1 -Device.
$src = @'
using System;
using System.Runtime.InteropServices;
public static class WinInList {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)] public struct CAPS {
    public ushort wMid; public ushort wPid; public uint vDriverVersion;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string szPname;
    public uint dwFormats; public ushort wChannels; public ushort wReserved1; }
  [DllImport("winmm.dll")] static extern uint waveInGetNumDevs();
  [DllImport("winmm.dll", CharSet = CharSet.Auto)] static extern uint waveInGetDevCaps(UIntPtr id, ref CAPS c, uint size);
  public static string List() {
    var s = "";
    for (uint i = 0; i < waveInGetNumDevs(); i++) {
      var c = new CAPS();
      waveInGetDevCaps((UIntPtr)i, ref c, (uint)Marshal.SizeOf(typeof(CAPS)));
      s += i + ": " + c.szPname + " (" + c.wChannels + " ch)\n";
    }
    return s;
  }
}
'@
if (-not ('WinInList' -as [type])) { Add-Type -TypeDefinition $src }
[WinInList]::List()
