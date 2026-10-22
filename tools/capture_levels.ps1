# Read-only: every active recording device with its Windows input level and mute state.
Add-Type -Language CSharp -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDevEnumCo {}
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
  int GetState(out int state);
}
[Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IPropertyStore { int GetCount(out int n); int GetAt(int i, out PROPERTYKEY k); int GetValue(ref PROPERTYKEY k, out PROPVARIANT v); }
[StructLayout(LayoutKind.Sequential)] struct PROPERTYKEY { public Guid fmtid; public int pid; }
[StructLayout(LayoutKind.Explicit)] struct PROPVARIANT { [FieldOffset(0)] public short vt; [FieldOffset(8)] public IntPtr p; }
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
  int RegisterControlChangeNotify(IntPtr n); int UnregisterControlChangeNotify(IntPtr n); int GetChannelCount(out int n);
  int SetMasterVolumeLevel(float l, Guid g); int SetMasterVolumeLevelScalar(float l, Guid g);
  int GetMasterVolumeLevel(out float l); int GetMasterVolumeLevelScalar(out float l);
  int SetChannelVolumeLevel(int c, float l, Guid g); int SetChannelVolumeLevelScalar(int c, float l, Guid g);
  int GetChannelVolumeLevel(int c, out float l); int GetChannelVolumeLevelScalar(int c, out float l);
  int SetMute(bool m, Guid g); int GetMute(out bool m);
}
public static class CapLevels {
  public static string List() {
    var en = (IMMDeviceEnumerator)new MMDevEnumCo();
    IMMDeviceCollection col; en.EnumAudioEndpoints(1, 1, out col);
    int n; col.GetCount(out n);
    var s = "";
    var nameKey = new PROPERTYKEY { fmtid = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0"), pid = 14 };
    for (int i = 0; i < n; i++) {
      IMMDevice d; col.Item(i, out d);
      IPropertyStore ps; d.OpenPropertyStore(0, out ps);
      PROPVARIANT v; ps.GetValue(ref nameKey, out v);
      string name = Marshal.PtrToStringUni(v.p);
      var iid = typeof(IAudioEndpointVolume).GUID; object o; d.Activate(ref iid, 23, IntPtr.Zero, out o);
      var vol = (IAudioEndpointVolume)o; float sc, db; bool mute; int ch;
      vol.GetMasterVolumeLevelScalar(out sc); vol.GetMasterVolumeLevel(out db); vol.GetMute(out mute); vol.GetChannelCount(out ch);
      s += name + ": level " + Math.Round(sc * 100) + "% (" + Math.Round(db, 1) + " dB), mute " + mute + ", " + ch + " ch\n";
    }
    return s;
  }
}
'@
[CapLevels]::List()
