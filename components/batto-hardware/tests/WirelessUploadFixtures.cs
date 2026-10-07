using Prism.LianLi;

internal static class WirelessUploadFixtures
{
    internal static int Run()
    {
        int checks = 0;
        void Check(bool value) { if (!value) throw new Exception("Wireless upload sequence failed"); checks++; }
        var master = new WirelessMaster("090807060504",8,106,1000);
        var target = new WirelessReceiver("010203040506",master.Mac,8,2,2,0,132,"Strimer",false,[0,0,0,0],3,0,[0,0,0,0]);
        var upload = WirelessProtocol.BuildUpload(target,master,[new byte[396]],100);
        Check(upload.Packets.Length >= 20);
        int writes = 0, reads = 0;
        var delays = new List<int>();
        Task Write(byte[] bytes,CancellationToken token) { Check(bytes.Length==64 && bytes[0]==0x10 && bytes[2]==8 && bytes[3]==2); writes++; return Task.CompletedTask; }
        Task Delay(int ms,CancellationToken token) { delays.Add(ms); token.ThrowIfCancellationRequested(); return Task.CompletedTask; }
        Task<WirelessReceiver> Read() { reads++; return Task.FromResult(writes>=upload.Packets.Length*2 ? target with {EffectIndex=upload.EffectIndex} : target); }
        var result=WirelessUploadRunner.Send(upload,target,master,Write,Read,Delay,CancellationToken.None).GetAwaiter().GetResult();
        Check(result.Confirmed && result.Attempts==2 && writes==upload.Packets.Length*2);
        Check(delays.Count(value=>value==20)==6 && reads==7);
        writes=0;reads=0;delays.Clear();
        result=WirelessUploadRunner.Send(upload,target,master,Write,()=>Task.FromResult(target),Delay,CancellationToken.None).GetAwaiter().GetResult();
        Check(!result.Confirmed && result.Attempts==3 && writes==upload.Packets.Length*3);
        Check(result.ObservedEffectIndex=="00000000");
        writes=0;
        try { WirelessUploadRunner.Send(upload,target,master,Write,()=>Task.FromResult(target with {RxType=3}),Delay,CancellationToken.None).GetAwaiter().GetResult(); throw new Exception("Changed target accepted"); }
        catch(IOException) { Check(writes==0); }
        using var cancel=new CancellationTokenSource(); cancel.Cancel();
        try { WirelessUploadRunner.Send(upload,target,master,Write,()=>Task.FromResult(target),Delay,cancel.Token).GetAwaiter().GetResult(); throw new Exception("Canceled upload accepted"); }
        catch(OperationCanceledException) { Check(writes==0); }
        return checks;
    }
}
