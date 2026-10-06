# Unveränderte Drittbibliotheken

Der Batto-Helfer verwendet unveränderte, austauschbare Bibliotheksdateien. Es wird kein CorsairLink-Plugin und kein Fan Control-Programm verteilt. Es wird kein PawnIO-Treiber verteilt oder installiert. Die LGPL-PawnIO-Module sind unverändert im offiziellen LibreHardwareMonitor-Paket eingebettet.

| Bibliothek | Version / genauer Quellstand | Lizenz / Quellverfügbarkeit |
| --- | --- | --- |
| LibreHardwareMonitorLib | 0.9.6 / `3d331e3370efb858411f19511373eff65a218701` | MPL-2.0, vollständiges unverändertes Archiv `LibreHardwareMonitor-v0.9.6-source.zip`; https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/tree/3d331e3370efb858411f19511373eff65a218701 |
| PawnIO.Modules | 0.1.6 / `4aa792beb020a14c8261072e9786d2dfb38489d9` | LGPL-2.1, unverändertes Archiv `PawnIO.Modules-0.1.6-source.zip`; https://github.com/namazso/PawnIO.Modules/tree/4aa792beb020a14c8261072e9786d2dfb38489d9 |
| BlackSharp.Core | 1.0.7 / `c70b735c6cec123ee8a046ac4a0bc6c606f52cf0` | MPL-2.0, vollständiges Archiv `BlackSharp.Core-1.0.7-source.zip`; https://github.com/Blacktempel/BlackSharp/tree/c70b735c6cec123ee8a046ac4a0bc6c606f52cf0 |
| DiskInfoToolkit | 1.1.2 / `25319eae5781e75bcf141e844ceab2afe94d40ea` | MPL-2.0, vollständiges Archiv `DiskInfoToolkit-1.1.2-source.zip`; https://github.com/Blacktempel/DiskInfoToolkit/tree/25319eae5781e75bcf141e844ceab2afe94d40ea |
| RAMSPDToolkit-NDD | 1.4.2 / `3b47b960e0830fef344624ad5e389675d5f0a1ce` | MPL-2.0, vollständiges Archiv `RAMSPDToolkit-NDD-1.4.2-source.zip`; https://github.com/Blacktempel/RAMSPDToolkit/tree/3b47b960e0830fef344624ad5e389675d5f0a1ce |
| HidSharp | 2.6.4 | Apache-2.0, vollständiger Paketlizenztext `HidSharp-2.6.4-Apache-2.0.txt`; https://software.seekye.com/hidsharp |
| Mono.Posix.NETStandard | 1.0.0 | Mono-Lizenzbeilage `Mono-MIT.txt`; https://github.com/mono/mono |
| .NET Laufzeit / Microsoft System-Bibliotheken | Laufzeit 8.0.31, genaue Paketversionen in `packages.lock.json` | .NET-Lizenz / Drittbeilagen `dotnet-8.0.31-LICENSE.txt`, `dotnet-8.0.31-THIRD-PARTY-NOTICES.txt`; https://github.com/dotnet/runtime |

Die Quellenarchive enthalten ihre ursprünglichen Copyright- und Lizenzhinweise. Buildskripte und Quellabhängigkeiten befinden sich im jeweiligen Archiv; eventuelle unveränderte Unterprojekte sind über die dortigen `.gitmodules` und Original-Commitreferenzen erhältlich. SHA-256-Belege stehen in `package-evidence.json`. Weitere NuGet-Paketversionen und Content-Hashes stehen in der mitgelieferten Lockdatei.

Für LibreHardwareMonitor ist das originale NuGet-Paket festgelegt: https://api.nuget.org/v3-flatcontainer/librehardwaremonitorlib/0.9.6/librehardwaremonitorlib.0.9.6.nupkg. Die API und Hardwaretreiber wurden nicht verändert. Die eigenen Fanheaderfilter, flüchtigen Sitzungseinstellungen und Steuerungsregeln stehen separat im offenen Batto-Helferquellcode.
