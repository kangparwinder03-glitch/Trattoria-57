# Trattoria 57 for Windows: low-level printer helper.
#   list                   -> JSON { printers: [...], ports: [{ port, name }] }
#   com <COM5> <file>      -> send the file's bytes to a COM port (Bluetooth printers paired in Windows)
#   win <printer> <file>   -> send the file's bytes RAW to an installed Windows printer (USB printers)
#   probe-com <COM5>       -> can we open the port (printer on and in range)?
#   probe-win <printer>    -> is the printer installed and not offline?
param([string]$Mode, [string]$Target, [string]$File)
$ErrorActionPreference = 'Stop'

function Raw-Helper {
  if (-not ('T57Raw' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class T57Raw {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DOCINFO { public string pDocName; public string pOutputFile; public string pDataType; }
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool OpenPrinter(string name, out IntPtr h, IntPtr d);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)] static extern int StartDocPrinter(IntPtr h, int level, [In] DOCINFO di);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool WritePrinter(IntPtr h, byte[] buf, int len, out int written);
  public static void Send(string printer, byte[] data) {
    IntPtr h;
    if (!OpenPrinter(printer, out h, IntPtr.Zero)) throw new Exception("Windows can't find the printer '" + printer + "'");
    try {
      DOCINFO di = new DOCINFO(); di.pDocName = "Trattoria 57"; di.pDataType = "RAW";
      if (StartDocPrinter(h, 1, di) == 0) throw new Exception("The printer '" + printer + "' wouldn't start the print (error " + Marshal.GetLastWin32Error() + ")");
      try {
        StartPagePrinter(h);
        int w; if (!WritePrinter(h, data, data.Length, out w) || w != data.Length) throw new Exception("Couldn't send everything to the printer");
        EndPagePrinter(h);
      } finally { EndDocPrinter(h); }
    } finally { ClosePrinter(h); }
  }
}
'@
  }
}

function Open-Com([string]$name) {
  $p = New-Object System.IO.Ports.SerialPort $name, 9600, ([System.IO.Ports.Parity]::None), 8, ([System.IO.Ports.StopBits]::One)
  $p.Handshake = [System.IO.Ports.Handshake]::None
  $p.WriteTimeout = 15000
  $p.Open()
  return $p
}

switch ($Mode) {
  'list' {
    $printers = @()
    try { $printers = @(Get-CimInstance Win32_Printer | ForEach-Object { $_.Name }) } catch {}
    $ports = @()
    try {
      $all = @(Get-CimInstance Win32_PnPEntity | Where-Object { $_.Name -match '\((COM\d+)\)' })
      $bt = @(Get-CimInstance Win32_PnPEntity | Where-Object { $_.PNPDeviceID -like 'BTHENUM\DEV_*' })
      foreach ($d in $all) {
        $null = $d.Name -match '\((COM\d+)\)'; $com = $Matches[1]; $nm = $d.Name
        if ($d.PNPDeviceID -match '&([0-9A-F]{12})_') {
          $mac = $Matches[1]
          if ($mac -eq '000000000000') { $nm = "Bluetooth (incoming - don't use this one)" }
          else {
            $dev = $bt | Where-Object { $_.PNPDeviceID -like "BTHENUM\DEV_$mac*" } | Select-Object -First 1
            $nm = if ($dev) { "Bluetooth: " + $dev.Name } else { "Bluetooth printer" }
          }
        }
        $ports += [pscustomobject]@{ port = $com; name = $nm }
      }
    } catch {}
    if (-not $ports.Count) { try { $ports = @([System.IO.Ports.SerialPort]::GetPortNames() | ForEach-Object { [pscustomobject]@{ port = $_; name = $_ } }) } catch {} }
    [pscustomobject]@{ printers = $printers; ports = $ports } | ConvertTo-Json -Depth 4 -Compress
  }
  'com' {
    $bytes = [System.IO.File]::ReadAllBytes($File)
    $p = Open-Com $Target
    try {
      # small pieces: cheap printers drop data (and garble the logo) if it arrives too fast
      for ($i = 0; $i -lt $bytes.Length; $i += 512) {
        $n = [Math]::Min(512, $bytes.Length - $i); $p.Write($bytes, $i, $n); Start-Sleep -Milliseconds 25
      }
      Start-Sleep -Milliseconds (1000 + [int]($bytes.Length / 20))
    } finally { $p.Close() }
    'ok'
  }
  'win' {
    Raw-Helper
    [T57Raw]::Send($Target, [System.IO.File]::ReadAllBytes($File))
    'ok'
  }
  'probe-com' { $p = Open-Com $Target; $p.Close(); 'ok' }
  'probe-win' {
    $pr = Get-CimInstance Win32_Printer | Where-Object { $_.Name -eq $Target } | Select-Object -First 1
    if (-not $pr) { throw "Windows can't find the printer '$Target'" }
    if ($pr.WorkOffline) { throw "Windows says the printer '$Target' is offline" }
    'ok'
  }
  default { throw "unknown mode $Mode" }
}
