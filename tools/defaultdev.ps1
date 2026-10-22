# Read-only: the Windows default playback and recording devices (console and multimedia roles).
Add-Type -Language CSharp -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDevEnumCo {}
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevEnum { int EnumAudioEndpoints(int f, int s, out IntPtr c); int GetDefaultAudioEndpoint(int f, int r, out IMMDev d); }
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDev { int Activate(ref Guid i, int c, IntPtr p, out IntPtr o); int OpenPropertyStore(int a, out IPropStore s); int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id); }
[Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IPropStore { int GetCount(out int c); int GetAt(int i, out PKEY k); int GetValue(ref PKEY k, out PVAR v); }
[StructLayout(LayoutKind.Sequential)] struct PKEY { public Guid fmtid; public int pid; }
[StructLayout(LayoutKind.Explicit)] struct PVAR { [FieldOffset(0)] public short vt; [FieldOffset(8)] public IntPtr p; }
public static class DefDev {
  public static string Name(int flow, int role) {
    var en = (IMMDevEnum)new MMDevEnumCo(); IMMDev d;
    if (en.GetDefaultAudioEndpoint(flow, role, out d) != 0) return "(none)";
    IPropStore ps; d.OpenPropertyStore(0, out ps);
    var k = new PKEY { fmtid = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0"), pid = 14 }; PVAR v; ps.GetValue(ref k, out v);
    return Marshal.PtrToStringUni(v.p);
  }
}
'@
"default playback (console):    " + [DefDev]::Name(0, 0)
"default playback (multimedia): " + [DefDev]::Name(0, 1)
"default recording (console):   " + [DefDev]::Name(1, 0)
