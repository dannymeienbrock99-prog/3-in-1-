// SPDX-License-Identifier: GPL-2.0-or-later
// Interoperates with OBS-VirtualCam 2.1.2's documented-in-source shared queue.
// Protocol: miaulightouch/obs-virtual-cam, src/queue/share_queue*. No OBS frontend.
using System.IO.MemoryMappedFiles;
using System.IO;
using System.Runtime.InteropServices;

internal sealed unsafe class VirtualCamera : IDisposable {
 [StructLayout(LayoutKind.Sequential)] struct OutputInfo {public nint id;public uint flags;public nint name,create,destroy,start,stop,rawVideo;}
 [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate nint NameCallback(nint data);
 [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate nint CreateCallback(nint settings,nint output);
 [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate void DestroyCallback(nint data);
 [UnmanagedFunctionPointer(CallingConvention.Cdecl)] [return:MarshalAs(UnmanagedType.I1)] delegate bool StartCallback(nint data);
 [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate void StopCallback(nint data,ulong ts);
 [DllImport("obs.dll")] static extern void obs_register_output_s(ref OutputInfo info,nuint size);
 [DllImport("obs.dll")] static extern void obs_output_set_media(nint output,nint video,nint audio);
 [DllImport("obs.dll")] [return:MarshalAs(UnmanagedType.I1)] static extern bool obs_output_begin_data_capture(nint output,uint flags);
 [DllImport("obs.dll")] static extern void obs_output_end_data_capture(nint output);
 static readonly System.Collections.Concurrent.ConcurrentDictionary<nint,VirtualCamera> outputs=new();
 static readonly nint title=Marshal.StringToCoTaskMemUTF8("Batto virtuelle Kamera"),id=Marshal.StringToCoTaskMemUTF8("batto_virtual_camera");
 static readonly NameCallback nameCallback=_=>title;
 static readonly CreateCallback createCallback=(_,output)=>output;
 static readonly DestroyCallback destroyCallback=_=>{};
 static readonly StartCallback startCallback=output=>obs_output_begin_data_capture(output,0);
 static readonly StopCallback stopCallback=(output,_)=>obs_output_end_data_capture(output);
 static readonly Obs.VideoCallback videoCallback=(output,frame)=>{if(outputs.TryGetValue(output,out var camera))camera.Write(0,frame);};
 public static void RegisterOutput(){var info=new OutputInfo{id=id,flags=1,name=Marshal.GetFunctionPointerForDelegate(nameCallback),create=Marshal.GetFunctionPointerForDelegate(createCallback),destroy=Marshal.GetFunctionPointerForDelegate(destroyCallback),start=Marshal.GetFunctionPointerForDelegate(startCallback),stop=Marshal.GetFunctionPointerForDelegate(stopCallback),rawVideo=Marshal.GetFunctionPointerForDelegate(videoCallback)};obs_register_output_s(ref info,(nuint)Marshal.SizeOf<OutputInfo>());}
 const int Header=64, FrameHeader=32, Slots=4;
 readonly int width,height,element; readonly nint video;
 MemoryMappedFile? mapping; MemoryMappedViewAccessor? view; byte* bytes; int index; nint output;
 public long Frames; public string Error="";
 public VirtualCamera(nint video,int width,int height,int slot){
  this.video=video;this.width=width;this.height=height;element=FrameHeader+width*height*3/2;
  try{
   mapping=MemoryMappedFile.CreateNew(slot==1?"OBSVirtualVideo":"OBSVirtualVideo2",Header+(long)element*Slots,MemoryMappedFileAccess.ReadWrite);
   view=mapping.CreateViewAccessor();view.SafeMemoryMappedViewHandle.AcquirePointer(ref bytes);
   // C queue_header uses 8-byte alignment (last_ts @48, frame_time @56).
   I(4,23);I(8,Slots);I(12,0);I(16,Header);I(20,element);I(24,FrameHeader);I(28,1);I(32,width);I(36,height);I(40,1);*(ulong*)(bytes+56)=1_000_000_000UL/30;I(0,1);
   output=Obs.obs_output_create("batto_virtual_camera","Batto Kamera "+slot,0,0);if(output==0)throw new InvalidOperationException("Kamera-Ausgang fehlt.");outputs[output]=this;obs_output_set_media(output,video,0);
   if(!Obs.obs_output_start(output))throw new InvalidOperationException("Virtuelle Kamera konnte nicht an die Leinwand angeschlossen werden.");
  }catch(IOException){Dispose();throw new InvalidOperationException("Diese virtuelle Kamera wird bereits von einem anderen Programm verwendet. Dort zuerst stoppen.");}catch{Dispose();throw;}
 }
 void I(int offset,int value)=>*(int*)(bytes+offset)=value;
 void Write(nint unused,nint data){
  try{
   var frame=(Obs.VideoData*)data;if(bytes==null||frame->data0==0||frame->data1==0||frame->stride0<width||frame->stride1<width)return;
   byte* target=bytes+Header+index*element;byte* pixels=target+FrameHeader;
   for(int y=0;y<height;y++)Buffer.MemoryCopy((byte*)frame->data0+y*frame->stride0,pixels+y*width,width,width);
   pixels+=width*height;for(int y=0;y<height/2;y++)Buffer.MemoryCopy((byte*)frame->data1+y*frame->stride1,pixels+y*width,width,width);
   *(ulong*)target=frame->timestamp;*(int*)(target+8)=width;*(int*)(target+12)=width;*(int*)(target+24)=width;*(int*)(target+28)=height;
   Thread.MemoryBarrier();Volatile.Write(ref *(int*)(bytes+12),index);index=(index+1)%Slots;if(index==0)Volatile.Write(ref *(int*)bytes,2);Interlocked.Increment(ref Frames);
  }catch(Exception){Error="Ein Kamerabild konnte nicht bereitgestellt werden.";}
 }
 public void Dispose(){if(output!=0){if(Obs.obs_output_active(output))Obs.obs_output_force_stop(output);outputs.TryRemove(output,out _);Obs.obs_output_release(output);output=0;}if(bytes!=null){Volatile.Write(ref *(int*)bytes,0);view!.SafeMemoryMappedViewHandle.ReleasePointer();bytes=null;}view?.Dispose();mapping?.Dispose();view=null;mapping=null;}
}
