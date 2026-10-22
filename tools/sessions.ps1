# Read-only: list the audio sessions on every active playback device, with the process and its current peak level.
Add-Type -Language CSharp -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;

[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorCo {}
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator {
  int EnumAudioEndpoints(int dataFlow, int stateMask, out IMMDeviceCollection devices);
  int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
}
[Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceCollection { int GetCount(out int n); int Item(int i, out IMMDevice d); }
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice {
  int Activate(ref Guid iid, int ctx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o);
  int OpenPropertyStore(int access, out IPropertyStore store);
  int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
}
[Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IPropertyStore { int GetCount(out int c); int GetAt(int i, out PROPERTYKEY k); int GetValue(ref PROPERTYKEY k, out PROPVARIANT v); }
[StructLayout(LayoutKind.Sequential)] struct PROPERTYKEY { public Guid fmtid; public int pid; }
[StructLayout(LayoutKind.Explicit)] struct PROPVARIANT { [FieldOffset(0)] public short vt; [FieldOffset(8)] public IntPtr p; }
[Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioSessionManager2 {
  int GetAudioSessionControl(IntPtr a, int b, out IntPtr c);
  int GetSimpleAudioVolume(IntPtr a, int b, out IntPtr c);
  int GetSessionEnumerator(out IAudioSessionEnumerator e);
}
[Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioSessionEnumerator { int GetCount(out int n); int GetSession(int i, out IAudioSessionControl2 s); }
[Guid("bfb7ff88-7239-4fc9-8fa2-07c950be9c6d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioSessionControl2 {
  int GetState(out int state);
  int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string n);
  int SetDisplayName(string a, ref Guid g);
  int GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string p);
  int SetIconPath(string a, ref Guid g);
  int GetGroupingParam(out Guid g);
  int SetGroupingParam(ref Guid a, ref Guid b);
  int RegisterAudioSessionNotification(IntPtr a);
  int UnregisterAudioSessionNotification(IntPtr a);
  int GetSessionIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string s);
  int GetSessionInstanceIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string s);
  int GetProcessId(out uint pid);
}
[Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioMeterInformation { int GetPeakValue(out float peak); }

public static class Sessions {
  public static List<string> List() {
    var res = new List<string>();
    var en = (IMMDeviceEnumerator)new MMDeviceEnumeratorCo();
    IMMDeviceCollection col; en.EnumAudioEndpoints(0, 1, out col);
    int n; col.GetCount(out n);
    var nameKey = new PROPERTYKEY { fmtid = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0"), pid = 14 };
    for (int i = 0; i < n; i++) {
      IMMDevice dev; col.Item(i, out dev);
      IPropertyStore ps; dev.OpenPropertyStore(0, out ps);
      PROPVARIANT pv; ps.GetValue(ref nameKey, out pv);
      string dname = Marshal.PtrToStringUni(pv.p);
      Guid iidMgr = typeof(IAudioSessionManager2).GUID; object o;
      dev.Activate(ref iidMgr, 23, IntPtr.Zero, out o);
      var mgr = (IAudioSessionManager2)o;
      IAudioSessionEnumerator se; mgr.GetSessionEnumerator(out se);
      int sc; se.GetCount(out sc);
      for (int j = 0; j < sc; j++) {
        IAudioSessionControl2 s; se.GetSession(j, out s);
        int state; s.GetState(out state);
        uint pid; s.GetProcessId(out pid);
        string pname = "?";
        try { pname = pid == 0 ? "System sounds" : Process.GetProcessById((int)pid).ProcessName; } catch {}
        float peak = -1;
        try { peak = ((IAudioMeterInformation)s).GetPeakValue(out peak) == 0 ? peak : -1; } catch {}
        res.Add(string.Format("{0} | {1} (pid {2}) | state {3} | peak {4:0.000}", dname, pname, pid, state == 1 ? "ACTIVE" : state == 0 ? "inactive" : "expired", peak));
      }
    }
    return res;
  }
}
'@
[Sessions]::List()
