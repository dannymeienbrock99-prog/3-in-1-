// SPDX-License-Identifier: GPL-2.0-or-later
using System.Text.Json.Nodes;
using System.Runtime.InteropServices;
using System.Diagnostics;
using System.Text.Json;
using System.IO;

internal sealed class Engine : IDisposable {
 readonly Dictionary<string,nint> sources=new();
 readonly Dictionary<string,Destination> destinations=new();
 readonly List<string> encoders=new();
 readonly Obs.Log quietLog=(_,_,_,_)=>{}; // Never log RTMP credentials, URLs or OBS internals to the parent/UI.
 readonly string root;
 bool started;
 nint graphics;
 string encoder="";
 bool prepared; nint media; readonly List<nint> mediaItems=new(); bool mediaVideo; long mediaDeadline;
 sealed class Destination { public Dictionary<string,nint> scenes=new(); public Dictionary<string,nint> items=new(); public string selected="Spiel"; public VirtualCamera? camera; public nint transition,chat,events,chatItem,eventItem; public nint scene,view,video,videoEncoder,audioEncoder,output,service; public int width,height,bitrate; public bool requested,recording; public string error=""; }
 public Engine(string root){this.root=Path.GetFullPath(root);}
 static string S(JsonNode? n,string key,string fallback="")=>n?[key]?.GetValue<string>()??fallback;
 static bool B(JsonNode? n,string key,bool fallback=false)=>n?[key]?.GetValue<bool>()??fallback;
 static double N(JsonNode? n,string key,double fallback=0)=>n?[key]?.GetValue<double>()??fallback;
 static nint Need(nint p,string message)=>p!=0?p:throw new InvalidOperationException(message);
 static nint Settings(object value)=>Need(Obs.obs_data_create_from_json(JsonSerializer.Serialize(value)),"Einstellungen konnten nicht gelesen werden.");
 public void Initialize(){
  string bin=Path.Combine(root,"bin","64bit");
  if(!File.Exists(Path.Combine(bin,"obs.dll")))throw new InvalidOperationException("Im gewählten Ordner fehlen die OBS-Bibliotheken.");
  Environment.CurrentDirectory=bin;Obs.SetDllDirectory(bin);
  Environment.SetEnvironmentVariable("PATH",bin+";"+Path.Combine(root,"obs-plugins","64bit")+";"+Environment.GetEnvironmentVariable("PATH"));
  NativeLibrary.SetDllImportResolver(typeof(Obs).Assembly,(name,_,_)=>name=="obs.dll"?NativeLibrary.Load(Path.Combine(bin,"obs.dll")):0);
  Obs.base_set_log_handler(quietLog,0);
  if(!Obs.obs_startup("de-DE",null!,0))throw new InvalidOperationException("Der Video-Dienst konnte nicht starten.");started=true;
  Obs.obs_add_data_path(Path.Combine(root,"data","libobs").Replace('\\','/'));
  graphics=Marshal.StringToCoTaskMemUTF8(Path.Combine(bin,"libobs-d3d11.dll").Replace('\\','/'));
  var audio=new Obs.Audio{rate=48000,speakers=2};if(!Obs.obs_reset_audio(ref audio))throw new InvalidOperationException("Audio konnte nicht vorbereitet werden.");
  var video=Video(1280,720);int result=Obs.obs_reset_video(ref video);if(result!=0)throw new InvalidOperationException("Grafikausgabe konnte nicht vorbereitet werden ("+result+").");
  // Deliberate allow-list: no browser, scripts, OBS UI, third-party plugins, recording or replay at startup.
  foreach(string name in new[]{"image-source","obs-transitions","obs-text","win-capture","win-dshow","win-wasapi"})LoadModule(name);
  Obs.obs_post_load_modules();
  VirtualCamera.RegisterOutput();
 }
 readonly HashSet<string> loadedModules=new();
 void LoadModule(string name){if(loadedModules.Contains(name))return;string dll=Path.Combine(root,"obs-plugins","64bit",name+".dll");if(!File.Exists(dll))return;if(Obs.obs_open_module(out var module,dll.Replace('\\','/'),Path.Combine(root,"data","obs-plugins",name).Replace('\\','/'))==0&&Obs.obs_init_module(module))loadedModules.Add(name);}
 void EnsureEncoding(){if(encoder.Length>0)return;string bin=Path.Combine(root,"bin","64bit");
  // OBS locates its signed encoder probes/mux helper beside the host executable.
  // Copy only these known helpers from the user's runtime, never download or execute arbitrary files.
  foreach(var helper in new[]{"obs-nvenc-test.exe","obs-amf-test.exe","obs-qsv-test.exe","obs-ffmpeg-mux.exe"}){
   var from=Path.Combine(bin,helper);var to=Path.Combine(AppContext.BaseDirectory,helper);
   if(File.Exists(from)&&(!File.Exists(to)||!System.Security.Cryptography.SHA256.HashData(File.ReadAllBytes(from)).SequenceEqual(System.Security.Cryptography.SHA256.HashData(File.ReadAllBytes(to)))))File.Copy(from,to,true);
  }
  foreach(string name in new[]{"obs-ffmpeg","obs-outputs","obs-nvenc","obs-qsv11","obs-x264","rtmp-services"})LoadModule(name);
  Obs.obs_post_load_modules();
  for(nuint i=0;Obs.obs_enum_encoder_types(i,out var p);i++)encoders.Add(Obs.Str(p));
  encoder=new[]{"obs_nvenc_h264_tex","h264_texture_amf","obs_qsv11_v2"}.FirstOrDefault(encoders.Contains)??"";
  if(encoder.Length==0)throw new InvalidOperationException("Hardware-Encoder nicht verfügbar.");
 }
 Obs.Video Video(int w,int h)=>new(){graphics=graphics,fpsNum=30,fpsDen=1,width=(uint)w,height=(uint)h,outWidth=(uint)w,outHeight=(uint)h,format=2,gpu=true,colorspace=2,range=1,scale=3};
 object Choices(string id,string property){
  var rows=new List<object>();nint props=Obs.obs_get_source_properties(id);if(props==0)return rows;
  try{var p=Obs.obs_properties_get(props,property);if(p==0)return rows;int format=Obs.obs_property_list_format(p);
   for(nuint i=0;i<Obs.obs_property_list_item_count(p);i++)rows.Add(new{name=Obs.Str(Obs.obs_property_list_item_name(p,i)),id=format==3?Obs.Str(Obs.obs_property_list_item_string(p,i)):Obs.obs_property_list_item_int(p,i).ToString()});
  }finally{Obs.obs_properties_destroy(props);}return rows;
 }
 public object Probe()=>new{virtualCameras=CameraRegistration.Status(),version=Obs.Str(Obs.obs_get_version_string()),encoder,encoders,
  devices=new{game=Choices("game_capture","window"),window=Choices("window_capture","window"),screen=Choices("monitor_capture","monitor_id"),camera=Choices("dshow_input","video_device_id"),microphone=Choices("wasapi_input_capture","device_id"),desktop=Choices("wasapi_output_capture","device_id")}};
 nint Source(string id,string name,object values){
  var latest=Obs.Str(Obs.obs_get_latest_input_type_id(id));if(latest.Length>0)id=latest;
  nint settings=Obs.obs_get_source_defaults(id);if(settings==0)settings=Obs.obs_data_create();nint patch=Settings(values);
  try{Obs.obs_data_apply(settings,patch);return Need(Obs.obs_source_create(id,name,settings,0),"Quelle konnte nicht erstellt werden: "+name);}finally{Obs.obs_data_release(patch);Obs.obs_data_release(settings);}
 }
 nint SceneCreate(string name,int width,int height){var scene=Need(Obs.obs_scene_create_private(name),"Szene konnte nicht erstellt werden.");var source=Obs.obs_scene_get_source(scene);var settings=Obs.obs_source_get_settings(source);var patch=Settings(new{custom_size=true,cx=width,cy=height});try{Obs.obs_data_apply(settings,patch);Obs.obs_source_load(source);}finally{Obs.obs_data_release(patch);Obs.obs_data_release(settings);}return scene;}
 public object Prepare(JsonNode config,bool test=false){
  if(destinations.Values.Any(d=>d.camera!=null||d.output!=0&&Obs.obs_output_active(d.output)))throw new InvalidOperationException("Erst beide Ausgaben stoppen.");
  Reset();
  try{
   var selected=config["sources"]!;
   if(test){sources["game"]=Source("color_source","Gemeinsames Testbild",new{color=0xFF603CB0,width=1280,height=720});sources["camera"]=Source("color_source","Kameraplatzhalter für Test",new{color=0xFF35C5EE,width=640,height=480});}
   else {
    foreach(string name in new[]{"game","camera","microphone","desktop"}){
     var s=selected[name];if(!B(s,"enabled"))continue;string target=S(s,"target");
     if(name=="game"){
      var kind=S(s,"kind","game");
      sources[name]=kind switch{
       "screen"=>Source("monitor_capture","Gemeinsamer Bildschirm",new{monitor_id=target,capture_cursor=true}),
       "window"=>Source("window_capture","Gemeinsames Fenster",new{window=target,priority=0,cursor=true}),
       _=>Source("game_capture","Gemeinsames Spiel",new{capture_mode="window",window=target,priority=0,limit_framerate=true,capture_cursor=true})};
     }else if(name=="camera")sources[name]=Source("dshow_input","Gemeinsame Kamera",new{video_device_id=target,res_type=0});
     else{sources[name]=Source(name=="microphone"?"wasapi_input_capture":"wasapi_output_capture",name=="microphone"?"Gemeinsames Mikrofon":"Gemeinsamer PC-Ton",new{device_id=target});Obs.obs_source_set_audio_mixers(sources[name],3);Obs.obs_set_output_source(name=="microphone"?1u:2u,sources[name]);}
    }
   }
   if(!sources.ContainsKey("game")&&!sources.ContainsKey("camera"))throw new InvalidOperationException("Bitte zuerst eine Bildquelle auswählen und einschalten.");
   // Audio comes exclusively from the explicitly enabled microphone / desktop inputs.
   // A camera or game plugin must not silently add another audio source.
   foreach(var s in sources)Obs.obs_source_set_audio_mixers(s.Value,s.Key is "microphone" or "desktop"?3u:0u);
   bool hd=S(config,"profile")=="fullhd_1080p30";
   foreach(string platform in new[]{"tiktok","twitch"}){
    var d=new Destination{width=platform=="tiktok"?(hd?1080:720):(hd?1920:1280),height=platform=="tiktok"?(hd?1920:1280):(hd?1080:720),bitrate=platform=="tiktok"?(hd?6000:3200):(hd?4500:3000)};destinations[platform]=d;
    d.scene=SceneCreate("Batto "+platform,d.width,d.height);
    var gameScene=SceneCreate("Spiel "+platform,d.width,d.height);d.scenes["Spiel"]=gameScene;
    foreach(var item in config["layouts"]![platform]!.AsArray()){
     string source=S(item,"source");if(!B(item,"visible",true)||!sources.TryGetValue(source,out var input))continue;
     nint sceneItem=Need(Obs.obs_scene_add(gameScene,input),"Quelle konnte nicht eingefügt werden.");
     d.items[source]=sceneItem;var pos=new Obs.Vec((float)N(item,"x")*d.width,(float)N(item,"y")*d.height);var size=new Obs.Vec((float)N(item,"width",1)*d.width,(float)N(item,"height",1)*d.height);
     Obs.obs_sceneitem_set_alignment(sceneItem,5);Obs.obs_sceneitem_set_pos(sceneItem,ref pos);Obs.obs_sceneitem_set_bounds_type(sceneItem,S(item,"fit")=="cover"?3:2);Obs.obs_sceneitem_set_bounds_alignment(sceneItem,0);Obs.obs_sceneitem_set_bounds_crop(sceneItem,true);Obs.obs_sceneitem_set_bounds(sceneItem,ref size);
    }
    foreach(string name in new[]{"Pause","Start","Ende"}){
     var stage=SceneCreate(name+" "+platform,d.width,d.height);d.scenes[name]=stage;
     string file=S(config["program"]?["backgrounds"],name);
     if(!string.IsNullOrEmpty(file)&&File.Exists(file)){
      string id="background-"+name;if(!sources.ContainsKey(id))sources[id]=Source("image_source",name+" Hintergrund",new{file,unload=false});
      var item=Obs.obs_scene_add(stage,sources[id]);var size=new Obs.Vec(d.width,d.height);Obs.obs_sceneitem_set_bounds_type(item,2);Obs.obs_sceneitem_set_bounds(item,ref size);
     }
    }
    d.transition=Source("fade_transition","Übergang "+platform,new{});Obs.obs_transition_set_size(d.transition,(uint)d.width,(uint)d.height);
    d.selected=S(config["program"],"scene","Spiel");if(!d.scenes.ContainsKey(d.selected))d.selected="Spiel";
    Obs.obs_transition_set(d.transition,Obs.obs_scene_get_source(d.scenes[d.selected]));Obs.obs_scene_add(d.scene,d.transition);
    foreach(string kind in new[]{"chat","events"}){
     var text=Source("text_gdiplus",kind+" "+platform,new{text="",font=new{face="Segoe UI",size=Math.Max(24,d.width/32),flags=0},color=0xFFFFFF,outline=true,outline_size=2,bk_color=0x121212,bk_opacity=70,extents=true,extents_cx=(int)(d.width*.94),extents_cy=(int)(d.height*(kind=="chat"?.20:.10)),word_wrap=true});
     var item=Obs.obs_scene_add(d.scene,text);var pos=new Obs.Vec(d.width*.03f,d.height*(kind=="chat"?.67f:.88f));var size=new Obs.Vec(d.width*.94f,d.height*(kind=="chat"?.20f:.10f));
     Obs.obs_sceneitem_set_alignment(item,5);Obs.obs_sceneitem_set_pos(item,ref pos);Obs.obs_sceneitem_set_bounds_type(item,2);Obs.obs_sceneitem_set_bounds(item,ref size);Obs.obs_sceneitem_set_visible(item,false);
     if(kind=="chat"){d.chat=text;d.chatItem=item;}else{d.events=text;d.eventItem=item;}
    }
    d.view=Need(Obs.obs_view_create(),"Videoansicht konnte nicht erstellt werden.");Obs.obs_view_set_source(d.view,0,Obs.obs_scene_get_source(d.scene));
   }
   prepared=true;return Status();
  }catch{Reset();throw;}
 }
 public object Scene(string name,string transition,int duration,string platform="both"){
  if(!new[]{"Spiel","Pause","Start","Ende"}.Contains(name)||!new[]{"cut","fade"}.Contains(transition)||duration<100||duration>2000||!new[]{"both","tiktok","twitch"}.Contains(platform))throw new InvalidOperationException("Ungültige Szene oder Übergang.");
  foreach(var pair in destinations.Where(x=>platform=="both"||x.Key==platform)){var d=pair.Value;var target=Obs.obs_scene_get_source(d.scenes[name]);if(transition=="cut")Obs.obs_transition_set(d.transition,target);else if(!Obs.obs_transition_start(d.transition,0,(uint)duration,target))throw new InvalidOperationException("Übergang läuft noch. Bitte kurz warten.");d.selected=name;}
  return Status();
 }
 public object Overlay(string chat,string events,bool chatVisible,bool eventsVisible){
  foreach(var d in destinations.Values){foreach(var item in new[]{(d.chat,chat),(d.events,events)}){var data=Settings(new{text=item.Item2[..Math.Min(1500,item.Item2.Length)]});try{Obs.obs_source_update(item.Item1,data);}finally{Obs.obs_data_release(data);}}Obs.obs_sceneitem_set_visible(d.chatItem,chatVisible&&!string.IsNullOrWhiteSpace(chat));Obs.obs_sceneitem_set_visible(d.eventItem,eventsVisible&&!string.IsNullOrWhiteSpace(events));}return Status();
 }
 public object SourceControl(string source,bool enabled){
  if(source is "microphone" or "desktop"){if(sources.TryGetValue(source,out var input))Obs.obs_source_set_muted(input,!enabled);}
  else if(source is "camera" or "game"){foreach(var d in destinations.Values)if(d.items.TryGetValue(source,out var item))Obs.obs_sceneitem_set_visible(item,enabled);}
  else throw new InvalidOperationException("Unbekannte Quelle.");return Status();
 }
 void ClearMedia(){foreach(var item in mediaItems)Obs.obs_sceneitem_remove(item);mediaItems.Clear();if(media!=0)Obs.obs_source_release(media);media=0;}
 public object Media(string file,double volume,int duration){
  if(!prepared)throw new InvalidOperationException("Bildquellen erst vorbereiten.");if(!File.Exists(file))throw new InvalidOperationException("Medium fehlt.");
  string ext=Path.GetExtension(file).ToLowerInvariant();bool image=new[]{".png",".jpg",".jpeg",".webp",".bmp"}.Contains(ext);if(!image&&!new[]{".mp4",".webm",".mkv",".mov",".mp3",".wav",".ogg",".m4a",".aac",".flac"}.Contains(ext))throw new InvalidOperationException("Dieses Medienformat ist nicht verfügbar.");
  if(media!=0)throw new InvalidOperationException("Ein Medium läuft bereits.");
  if(!image)LoadModule("obs-ffmpeg");
  mediaVideo=!image;media=Source(image?"image_source":"ffmpeg_source","Batto Stream-Medium",image?(object)new{file,unload=false}:new{local_file=file,is_local_file=true,looping=false,hw_decode=true,restart_on_activate=true,close_when_inactive=true});Obs.obs_source_set_audio_mixers(media,mixers);Obs.obs_source_set_volume(media,(float)Math.Clamp(volume,0,1));
  foreach(var d in destinations.Values){var item=Obs.obs_scene_add(d.scene,media);mediaItems.Add(item);var size=new Obs.Vec(d.width,d.height);Obs.obs_sceneitem_set_bounds_type(item,2);Obs.obs_sceneitem_set_bounds(item,ref size);}
  mediaDeadline=Environment.TickCount64+Math.Clamp(duration,1,120)*1000;return new{ok=true};
 }
 public object MediaState(){if(media!=0&&(Environment.TickCount64>mediaDeadline||mediaVideo&&Obs.obs_source_media_get_state(media) is 5 or 6 or 7))ClearMedia();return new{active=media!=0};}
 public object MediaStop(){ClearMedia();return new{ok=true};}
 void EnsureVideo(Destination d){if(d.video!=0)return;var video=Video(d.width,d.height);d.video=Need(Obs.obs_view_add2(d.view,ref video),"Videoausgabe konnte nicht erstellt werden.");}
 public object StartCamera(string platform){
  if(!prepared||!destinations.TryGetValue(platform,out var d))throw new InvalidOperationException("Erst Quellen vorbereiten.");
  if(d.camera!=null)throw new InvalidOperationException("Diese virtuelle Kamera läuft bereits.");
  int slot=platform=="tiktok"?1:2;if(!CameraRegistration.Ready(slot))throw new InvalidOperationException("Virtuelle Kameras erst einrichten.");
  EnsureVideo(d);try{d.camera=new VirtualCamera(d.video,d.width,d.height,slot);d.error="";}catch{Obs.obs_view_remove(d.view);d.video=0;throw;}return Status();
 }
 public object Start(string platform,string? server,string? key,string? file=null){
  if(!prepared||!destinations.TryGetValue(platform,out var d))throw new InvalidOperationException("Erst Quellen vorbereiten.");
  if(d.output!=0&&Obs.obs_output_active(d.output))throw new InvalidOperationException("Diese Ausgabe ist bereits gestartet.");
  EnsureEncoding();ReleaseOutput(d);EnsureVideo(d);d.error="";
  try{
   var settings=Obs.obs_get_encoder_defaults(encoder);var patch=Settings(new{rate_control="CBR",bitrate=d.bitrate,keyint_sec=2,preset="p3",preset2="p3",multipass="disabled",lookahead=false,psycho_aq=false,adaptive_quantization=false,bf=2});
   try{Obs.obs_data_apply(settings,patch);d.videoEncoder=Need(Obs.obs_video_encoder_create(encoder,"Batto Video "+platform,settings,0),"Hardware-Encoder nicht verfügbar.");Obs.obs_encoder_set_video(d.videoEncoder,d.video);}finally{Obs.obs_data_release(patch);Obs.obs_data_release(settings);}
   var a=Settings(new{bitrate=128});try{d.audioEncoder=Need(Obs.obs_audio_encoder_create("ffmpeg_aac","Batto Audio "+platform,a,platform=="tiktok"?0u:1u,0),"AAC-Encoder nicht verfügbar.");Obs.obs_encoder_set_audio(d.audioEncoder,Obs.obs_get_audio());}finally{Obs.obs_data_release(a);}
   if(file!=null){var data=Settings(new{path=file});try{d.output=Need(Obs.obs_output_create("ffmpeg_muxer","Batto Test "+platform,data,0),"Testausgabe nicht verfügbar.");}finally{Obs.obs_data_release(data);}}
   else{
    if(string.IsNullOrEmpty(server)||string.IsNullOrEmpty(key))throw new InvalidOperationException("Server und Stream-Key fehlen.");
    var data=Settings(new{server,key});try{d.service=Need(Obs.obs_service_create("rtmp_custom","Batto Ziel "+platform,data,0),"Sendeziel konnte nicht erstellt werden.");}finally{Obs.obs_data_release(data);}
    d.output=Need(Obs.obs_output_create("rtmp_output","Batto Live "+platform,0,0),"RTMP-Ausgabe nicht verfügbar.");Obs.obs_output_set_service(d.output,d.service);
   }
   Obs.obs_output_set_video_encoder(d.output,d.videoEncoder);Obs.obs_output_set_audio_encoder(d.output,d.audioEncoder,0);
   if(!Obs.obs_output_start(d.output))throw new InvalidOperationException("Ausgabe konnte nicht starten. Encoder und Sendezugang prüfen.");
   d.requested=true;d.recording=file!=null;return Status();
  }catch{ReleaseOutput(d);throw;}
 }
 public object Stop(string platform){if(platform=="both"){foreach(var d in destinations.Values)StopOutput(d);}else if(destinations.TryGetValue(platform,out var d))StopOutput(d);return Status();}
 static void StopOutput(Destination d){
  d.camera?.Dispose();d.camera=null;
  if(d.output!=0&&Obs.obs_output_active(d.output)){Obs.obs_output_stop(d.output);var t=Stopwatch.StartNew();while(Obs.obs_output_active(d.output)&&t.ElapsedMilliseconds<4000)Thread.Sleep(30);if(Obs.obs_output_active(d.output)){Obs.obs_output_force_stop(d.output);t.Restart();while(Obs.obs_output_active(d.output)&&t.ElapsedMilliseconds<2000)Thread.Sleep(20);}}
  d.requested=false;if(d.video!=0){Obs.obs_view_remove(d.view);d.video=0;}
 }
 public object Mute(string platform,bool muted){uint bit=platform=="tiktok"?1u:2u;var configMix=muted?0u:bit;mixers=(mixers&~bit)|configMix;foreach(string id in new[]{"microphone","desktop"})if(sources.TryGetValue(id,out var source))Obs.obs_source_set_audio_mixers(source,mixers);if(media!=0)Obs.obs_source_set_audio_mixers(media,mixers);return Status();}
 uint mixers=3;
 public object Snapshot(string platform){
  if(!prepared||!destinations.TryGetValue(platform,out var d))throw new InvalidOperationException("Erst Quellen vorbereiten.");
  int width=d.width>d.height?640:360,height=d.width>d.height?360:640;byte[] pixels=new byte[width*height*4];nint render=0,surface=0;
  Obs.obs_enter_graphics();
  try{
   render=Need(Obs.gs_texrender_create(5,0),"Vorschaubild nicht verfügbar.");surface=Need(Obs.gs_stagesurface_create((uint)width,(uint)height,5),"Vorschaubild nicht verfügbar.");
   Obs.gs_viewport_push();Obs.gs_projection_push();Obs.gs_matrix_push();
   try{if(!Obs.gs_texrender_begin(render,(uint)width,(uint)height))throw new InvalidOperationException("Vorschaubild nicht verfügbar.");
    try{Obs.gs_matrix_identity();Obs.gs_ortho(0,d.width,0,d.height,-100,100);var black=new Obs.Color{a=1};Obs.gs_clear(1,ref black,1,0);Obs.obs_source_video_render(Obs.obs_scene_get_source(d.scene));}finally{Obs.gs_texrender_end(render);}
   }finally{Obs.gs_matrix_pop();Obs.gs_projection_pop();Obs.gs_viewport_pop();}
   Obs.gs_stage_texture(surface,Obs.gs_texrender_get_texture(render));
   if(!Obs.gs_stagesurface_map(surface,out var data,out uint stride))throw new InvalidOperationException("Vorschaubild konnte nicht gelesen werden.");
   try{for(int y=0;y<height;y++)Marshal.Copy(data+(int)(y*stride),pixels,y*width*4,width*4);}finally{Obs.gs_stagesurface_unmap(surface);}
  }finally{if(surface!=0)Obs.gs_stagesurface_destroy(surface);if(render!=0)Obs.gs_texrender_destroy(render);Obs.obs_leave_graphics();}
  using var bitmap=new System.Drawing.Bitmap(width,height,System.Drawing.Imaging.PixelFormat.Format32bppArgb);
  var locked=bitmap.LockBits(new System.Drawing.Rectangle(0,0,width,height),System.Drawing.Imaging.ImageLockMode.WriteOnly,System.Drawing.Imaging.PixelFormat.Format32bppArgb);
  try{for(int y=0;y<height;y++)Marshal.Copy(pixels,y*width*4,locked.Scan0+y*locked.Stride,width*4);}finally{bitmap.UnlockBits(locked);}
  using var stream=new MemoryStream();bitmap.Save(stream,System.Drawing.Imaging.ImageFormat.Png);return new{image="data:image/png;base64,"+Convert.ToBase64String(stream.ToArray()),width,height,capturedAt=DateTimeOffset.UtcNow};
 }
 public object Status()=>new{prepared,encoder,virtualCameras=CameraRegistration.Status(),version=Obs.Str(Obs.obs_get_version_string()),sourceCount=sources.Count,overlays=destinations.ToDictionary(x=>x.Key,x=>new{chatWidth=Obs.obs_source_get_width(x.Value.chat),eventWidth=Obs.obs_source_get_width(x.Value.events)}),
  sources=sources.Select(s=>new{id=s.Key,width=Obs.obs_source_get_width(s.Value),height=Obs.obs_source_get_height(s.Value)}),
  renderedFrames=Obs.obs_get_total_frames(),laggedFrames=Obs.obs_get_lagged_frames(),
  outputs=destinations.ToDictionary(x=>x.Key,x=>{var d=x.Value;bool active=d.output!=0&&Obs.obs_output_active(d.output);ulong bytes=d.output==0?0:Obs.obs_output_get_total_bytes(d.output);if(d.requested&&!active)d.error="Ausgabe beendet oder Verbindung fehlgeschlagen. Sendezugang und Netzwerk prüfen.";return (object)new{cameraName=CameraRegistration.Name(x.Key=="tiktok"?1:2),scene=d.selected,d.width,d.height,d.bitrate,state=d.camera!=null?"camera":d.requested?(active?(bytes>0?(d.recording?"test":"live"):"connecting"):"error"):"stopped",bytes,frames=d.camera?.Frames??(d.output==0?0:Obs.obs_output_get_total_frames(d.output)),droppedFrames=d.output==0?0:Obs.obs_output_get_frames_dropped(d.output),error=d.error,muted=(mixers&(x.Key=="tiktok"?1:2))==0};})};
 static void ReleaseOutput(Destination d){StopOutput(d);if(d.output!=0)Obs.obs_output_release(d.output);if(d.service!=0)Obs.obs_service_release(d.service);if(d.videoEncoder!=0)Obs.obs_encoder_release(d.videoEncoder);if(d.audioEncoder!=0)Obs.obs_encoder_release(d.audioEncoder);d.output=d.service=d.videoEncoder=d.audioEncoder=0;}
 void Reset(){ClearMedia();prepared=false;foreach(var d in destinations.Values){ReleaseOutput(d);if(d.view!=0){Obs.obs_view_remove(d.view);Obs.obs_view_set_source(d.view,0,0);Obs.obs_view_destroy(d.view);}if(d.scene!=0)Obs.obs_scene_release(d.scene);if(d.transition!=0)Obs.obs_source_release(d.transition);foreach(var scene in d.scenes.Values)Obs.obs_scene_release(scene);if(d.chat!=0)Obs.obs_source_release(d.chat);if(d.events!=0)Obs.obs_source_release(d.events);}destinations.Clear();Obs.obs_set_output_source(1,0);Obs.obs_set_output_source(2,0);foreach(var s in sources.Values)Obs.obs_source_release(s);sources.Clear();mixers=3;}
 public void Dispose(){if(started){Reset();Obs.obs_shutdown();started=false;}if(graphics!=0)Marshal.FreeCoTaskMem(graphics);}
}

internal static class Program {
 [STAThread] static int Main(string[] args){
  if(args.Contains("--register-cameras")||args.Contains("--unregister-cameras")){try{if(args.Contains("--register-cameras"))CameraRegistration.Register();else CameraRegistration.Unregister();Console.WriteLine(JsonSerializer.Serialize(CameraRegistration.Status()));return 0;}catch(Exception e){Console.Error.WriteLine(e.Message);return 1;}}
  Console.InputEncoding=new System.Text.UTF8Encoding(false);Console.OutputEncoding=new System.Text.UTF8Encoding(false);
  using var engine=new Engine(args.Length>0?args[0]:"");
  try{engine.Initialize();Console.WriteLine("BATTO_JSON:"+JsonSerializer.Serialize(new{ready=true}));}
  catch(Exception e){Console.WriteLine("BATTO_JSON:"+JsonSerializer.Serialize(new{ready=false,error=e is InvalidOperationException?e.Message:"OBS-Bibliotheken konnten nicht geladen werden."}));return 1;}
  string? line;
  while((line=Console.ReadLine())!=null){
   JsonNode? req=null;try{
    req=JsonNode.Parse(line);var command=req?["command"]?.GetValue<string>();object? result=command switch{
     "probe"=>engine.Probe(),"status"=>engine.Status(),"prepare"=>engine.Prepare(req!["config"]!),
     "start"=>engine.Start(req!["platform"]!.GetValue<string>(),req["server"]?.GetValue<string>(),req["key"]?.GetValue<string>()),
     "camera-start"=>engine.StartCamera(req!["platform"]!.GetValue<string>()),
     "stop"=>engine.Stop(req!["platform"]!.GetValue<string>()),"mute"=>engine.Mute(req!["platform"]!.GetValue<string>(),req["muted"]!.GetValue<bool>()),
     "scene"=>engine.Scene(req!["scene"]!.GetValue<string>(),req["transition"]!.GetValue<string>(),req["durationMs"]!.GetValue<int>(),req["platform"]?.GetValue<string>()??"both"),
     "overlay"=>engine.Overlay(req!["chat"]!.GetValue<string>(),req["events"]!.GetValue<string>(),req["chatVisible"]!.GetValue<bool>(),req["eventsVisible"]!.GetValue<bool>()),
     "source"=>engine.SourceControl(req!["source"]!.GetValue<string>(),req["enabled"]!.GetValue<bool>()),
     "media"=>engine.Media(req!["path"]!.GetValue<string>(),req["volume"]?.GetValue<double>()??1,req["duration"]?.GetValue<int>()??30),
     "media-state"=>engine.MediaState(),"media-stop"=>engine.MediaStop(),
     "snapshot"=>engine.Snapshot(req!["platform"]!.GetValue<string>()),
     "test-prepare" when Environment.GetEnvironmentVariable("BATTO_DUAL_TEST")=="1"=>engine.Prepare(req!["config"]!,true),
     "test-record" when Environment.GetEnvironmentVariable("BATTO_DUAL_TEST")=="1"=>engine.Start(req!["platform"]!.GetValue<string>(),null,null,req["path"]!.GetValue<string>()),
     "quit"=>null,_=>throw new InvalidOperationException("Unbekannte Video-Aktion.")};
    Console.WriteLine("BATTO_JSON:"+JsonSerializer.Serialize(new{id=req?["id"]?.GetValue<int>(),ok=true,result}));if(command=="quit")break;
   }catch(Exception e){Console.WriteLine("BATTO_JSON:"+JsonSerializer.Serialize(new{id=req?["id"]?.GetValue<int>(),ok=false,error=Environment.GetEnvironmentVariable("BATTO_DUAL_TEST")=="1"?e.ToString():e is InvalidOperationException?e.Message:"Video-Aktion fehlgeschlagen."}));}
  }return 0;
 }
}
