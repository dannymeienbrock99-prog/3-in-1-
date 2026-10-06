using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using Batto.Hardware;

unsafe class Program
{
    static int Main()
    {
        var checks = new List<string>();
        void Check(string name, bool passed) { if (!passed) throw new Exception("Check failed: " + name); checks.Add(name); }
        JsonElement Call(string request)
        {
            byte[] bytes = Encoding.UTF8.GetBytes(request); nint result = 0; int length = 0;
            delegate* unmanaged[Cdecl]<byte*, int, nint*, int*, int> invoke = &NativeExports.Invoke;
            delegate* unmanaged[Cdecl]<nint, void> free = &NativeExports.Free;
            fixed (byte* input = bytes)
            {
                int code = invoke(input, bytes.Length, &result, &length);
                Check("abiCode", code == 0 && result != 0 && length > 0);
                try { return JsonDocument.Parse(new ReadOnlySpan<byte>((void*)result, length).ToArray()).RootElement.Clone(); }
                finally { free(result); free(result); }
            }
        }
        bool Rejected(string request) => !Call(request).GetProperty("ok").GetBoolean();
        var caps = Call("{\"requestId\":1,\"command\":\"capabilities\"}").GetProperty("result");
        Check("inProcessOnly", caps.GetProperty("inProcess").GetBoolean() && !caps.GetProperty("childProcesses").GetBoolean());
        Check("noAutomaticVendorPause", !caps.GetProperty("automaticVendorPause").GetBoolean() && caps.GetProperty("vendorServiceControlAvailable").GetBoolean());
        var pure = Call("{\"requestId\":2,\"command\":\"self-test\"}").GetProperty("result");
        Check("realProtocolPureCheck", pure.GetProperty("passed").GetBoolean() && pure.GetProperty("hardwarePackets").GetInt32() == 0);
        Check("serviceLeaseFailureFixtures",pure.GetProperty("serviceLeaseChecks").GetInt32()>=28);
        Check("loadHasNoHardware", !pure.GetProperty("wirelessOpened").GetBoolean() && !pure.GetProperty("fanCreated").GetBoolean() && !pure.GetProperty("serviceControlCreated").GetBoolean());
        Check("unknownProvider", Rejected("{\"requestId\":3,\"provider\":\"iCUE\",\"command\":\"enumerate\"}"));
        Check("serviceCommandRejected", Rejected("{\"requestId\":4,\"command\":\"stop-service\"}"));
        Check("extraPropertiesRejected", Rejected("{\"requestId\":5,\"command\":\"capabilities\",\"shell\":\"anything\"}"));
        Check("duplicatePropertiesRejected", Rejected("{\"requestId\":6,\"command\":\"capabilities\",\"command\":\"animation\"}"));
        Check("badJsonRejected", Rejected("{oops"));
        Check("invalidIdentityRejected", Rejected("{\"requestId\":-1,\"command\":\"capabilities\"}"));
        Check("animationBeforeScanRejected", Rejected("{\"requestId\":7,\"command\":\"animation\",\"deviceId\":60000,\"frameCount\":1,\"intervalMs\":100,\"rgb\":\"AA==\"}"));
        var closed = Call("{\"requestId\":8,\"command\":\"close\"}");
        Check("closeWithoutOpening", closed.GetProperty("ok").GetBoolean() && closed.GetProperty("result").GetProperty("closed").GetBoolean());
        var fanCheck=Call("{\"requestId\":9,\"provider\":\"fan\",\"command\":\"self-test\"}");
        Check("fanEnginePureCheck",fanCheck.GetProperty("ok").GetBoolean()&&fanCheck.GetProperty("result").GetProperty("checks").GetInt32()==8);
        var fanStatus=Call("{\"requestId\":10,\"provider\":\"fan\",\"command\":\"status\"}");
        Check("fanReplyCorrelation",fanStatus.GetProperty("requestId").GetInt32()==10&&fanStatus.GetProperty("ok").GetBoolean());
        Check("fanStatusDoesNotOpen",!fanStatus.GetProperty("state").GetProperty("enabled").GetBoolean()&&fanStatus.GetProperty("state").GetProperty("channels").GetArrayLength()==0);
        var fanDisabled=Call("{\"requestId\":11,\"provider\":\"fan\",\"command\":\"disable\"}");
        Check("fanDisableWithoutOpening",fanDisabled.GetProperty("ok").GetBoolean()&&fanDisabled.GetProperty("released").GetBoolean());
        var windowsStatus=Call("{\"requestId\":12,\"provider\":\"windows\",\"command\":\"status\"}");
        Check("windowsStatusInCaller",windowsStatus.GetProperty("ok").GetBoolean()&&windowsStatus.GetProperty("result").GetProperty("processId").GetInt32()==Environment.ProcessId);
        var noDevice=Call("{\"requestId\":13,\"provider\":\"windows\",\"command\":\"set\",\"deviceId\":10000,\"colors\":[1]}");
        Check("vendorErrorPreserved",!noDevice.GetProperty("ok").GetBoolean()&&noDevice.GetProperty("error").GetProperty("code").GetString()=="DEVICE_NOT_FOUND");
        var windowsClosed=Call("{\"requestId\":14,\"provider\":\"windows\",\"command\":\"close\"}");
        Check("windowsCloseUnopened",windowsClosed.GetProperty("ok").GetBoolean()&&windowsClosed.GetProperty("result").GetProperty("releaseRequested").GetBoolean()&&windowsClosed.GetProperty("result").GetProperty("verification").GetString()=="unconfirmed");
        var lianliPure=Call("{\"requestId\":15,\"provider\":\"lianli\",\"command\":\"self-test\"}").GetProperty("result");
        Check("lianliProtocolPure",lianliPure.GetProperty("passed").GetBoolean()&&lianliPure.GetProperty("hardwarePackets").GetInt32()==0&&!lianliPure.GetProperty("lianliCreated").GetBoolean());
        Check("strimerControllerScopePure",lianliPure.GetProperty("strimerPlusV2Protocol").GetBoolean());
        var lianliStatus=Call("{\"requestId\":16,\"provider\":\"lianli\",\"command\":\"status\"}").GetProperty("result");
        Check("lianliStatusDoesNotOpen",lianliStatus.GetProperty("processId").GetInt32()==Environment.ProcessId&&lianliStatus.GetProperty("controllerCount").GetInt32()==0&&lianliStatus.GetProperty("deviceCount").GetInt32()==0);
        var lianliTelemetry=Call("{\"requestId\":17,\"provider\":\"lianli\",\"command\":\"telemetry\"}").GetProperty("result");
        Check("lianliTelemetryDoesNotOpen",lianliTelemetry.GetProperty("devices").GetArrayLength()==0&&!lianliTelemetry.GetProperty("layoutChanged").GetBoolean());
        Check("lianliCannotInvokeServices",Rejected("{\"requestId\":18,\"provider\":\"lianli\",\"command\":\"stop-service\"}"));
        var lianliClosed=Call("{\"requestId\":19,\"provider\":\"lianli\",\"command\":\"close\"}").GetProperty("result");
        Check("lianliCloseUnopened",lianliClosed.GetProperty("closed").GetBoolean());
        Check("takeControlNeedsConsent",Rejected("{\"requestId\":20,\"provider\":\"wireless\",\"command\":\"take-control\",\"confirmLConnectPause\":false}"));
        var controlStatus=Call("{\"requestId\":21,\"provider\":\"wireless\",\"command\":\"control-status\"}").GetProperty("result");
        Check("controlStatusIdle",!controlStatus.GetProperty("active").GetBoolean()&&controlStatus.GetProperty("remaining").GetArrayLength()==0);
        var controlReleased=Call("{\"requestId\":22,\"provider\":\"wireless\",\"command\":\"release-control\"}").GetProperty("result");
        Check("releaseControlIdle",controlReleased.GetProperty("ok").GetBoolean()&&controlReleased.GetProperty("restored").GetBoolean());
        var idleAgain=Call("{\"requestId\":23,\"provider\":\"wireless\",\"command\":\"self-test\"}").GetProperty("result");
        Check("idleControlDoesNotOpenScm",!idleAgain.GetProperty("serviceControlCreated").GetBoolean());
        var inventoryPure=Call("{\"requestId\":24,\"provider\":\"inventory\",\"command\":\"self-test\"}").GetProperty("result");
        Check("inventoryFixturesReadOnly",inventoryPure.GetProperty("ok").GetBoolean()&&inventoryPure.GetProperty("passed").GetInt32()>0&&inventoryPure.GetProperty("hardwarePackets").GetInt32()==0&&inventoryPure.GetProperty("realServiceControls").GetInt32()==0);
        var inventoryStatus=Call("{\"requestId\":25,\"provider\":\"inventory\",\"command\":\"status\"}").GetProperty("result");
        Check("inventoryStatusNoInspection",inventoryStatus.GetProperty("processId").GetInt32()==Environment.ProcessId&&!inventoryStatus.GetProperty("platformCached").GetBoolean()&&!inventoryStatus.GetProperty("kingstonCached").GetBoolean());
        var inventoryClosed=Call("{\"requestId\":26,\"provider\":\"inventory\",\"command\":\"close\"}").GetProperty("result");
        Check("inventoryCloseNoInspection",inventoryClosed.GetProperty("closed").GetBoolean()&&!inventoryClosed.GetProperty("platformCached").GetBoolean()&&!inventoryClosed.GetProperty("kingstonCached").GetBoolean());
        delegate* unmanaged[Cdecl]<byte*, int, nint*, int*, int> direct = &NativeExports.Invoke;
        nint response=0;int responseLength=0;
        Check("nullOutputRejected", direct(null,0,null,null)==-1);
        Check("nullInputRejected", direct(null,4,&response,&responseLength)==-1&&response==0&&responseLength==0);
        byte[] oversized=new byte[NativeExports.MaximumRequestBytes+1];fixed(byte* ptr=oversized) Check("oversizedInputRejected",direct(ptr,oversized.Length,&response,&responseLength)==-1);
        var malformed=NativeExports.Execute([0xff,0xff]);using var malformedDoc=JsonDocument.Parse(malformed);
        Check("invalidUtf8Rejected",!malformedDoc.RootElement.GetProperty("ok").GetBoolean());
        Console.WriteLine(JsonSerializer.Serialize(new { passed=checks.Count,checks,hardwarePackets=0,fanWrites=0,realServiceControls=0 }));return 0;
    }
}
