// SPDX-License-Identifier: GPL-2.0-or-later
using System.Text.Json.Nodes;
using System.Runtime.InteropServices;
using System.Diagnostics;
using System.Text.Json;
using System.IO;

internal sealed class Engine : IDisposable {
 readonly Dictionary<string,nint> sources=new();
 readonly Dictionary<string,nint> backgroundSources=new(StringComparer.OrdinalIgnoreCase);
 readonly HashSet<nint> ownedScenes=new();
 readonly Dictionary<string,List<(nint Item,bool Visible)>> captureItems=new();
 readonly Dictionary<string,string> cameraTargets=new(StringComparer.OrdinalIgnoreCase);
 static readonly string[] CameraIds={"camera","camera2","camera3"};
 readonly List<string> importWarnings=new();
 readonly Dictionary<string,JsonNode> transitionDefinitions=new(StringComparer.Ordinal);
 readonly HashSet<nint> videoSources=new();
 readonly Dictionary<string,Destination> destinations=new();
 readonly List<string> encoders=new();
 readonly Obs.Log quietLog=(_,_,_,_)=>{}; // Never log RTMP credentials, URLs or OBS internals to the parent/UI.
 readonly string root;
 bool started;
 bool disposed;
 internal object Sync {get;}=new();
 readonly System.Threading.Timer previewTimer;
 nint graphics;
 string encoder="";
 bool prepared; nint media; readonly List<nint> mediaItems=new(); bool mediaVideo; long mediaDeadline;
 sealed class Destination { public Dictionary<string,nint> scenes=new(); public Dictionary<string,string> sceneLabels=new(); public string selected="Spiel",transitionId="fade"; public VirtualCamera? camera; public nint transition,transitionItem,chat,events,chatItem,eventItem; public nint scene,sourceScene,view,video,videoEncoder,audioEncoder,output,service,previewSource; public long previewDeadline; public int width,height,bitrate; public bool requested,recording; public string error=""; }
 public Engine(string root){this.root=Path.GetFullPath(root);previewTimer=new System.Threading.Timer(_=>{lock(Sync){if(disposed)return;foreach(var d in destinations.Values){if(d.previewSource!=0&&Environment.TickCount64>=d.previewDeadline)ReleasePreview(d);ReleaseFinishedTransition(d);}}},null,250,250);}
 static void ReleasePreview(Destination d){if(d.previewSource==0)return;var source=d.previewSource;d.previewSource=0;d.previewDeadline=0;Obs.obs_source_dec_active(source);}
 static string S(JsonNode? n,string key,string fallback="")=>n?[key]?.GetValue<string>()??fallback;
 static bool B(JsonNode? n,string key,bool fallback=false)=>n?[key]?.GetValue<bool>()??fallback;
 static double N(JsonNode? n,string key,double fallback=0)=>n?[key]?.GetValue<double>()??fallback;
 static nint Need(nint p,string message)=>p!=0?p:throw new InvalidOperationException(message);
 static nint Settings(object value)=>Need(Obs.obs_data_create_from_json(JsonSerializer.Serialize(value)),"Einstellungen konnten nicht gelesen werden.");
 public void Initialize(){
  if(Environment.GetEnvironmentVariable("BATTO_DUAL_TEST")!="1")CameraRegistration.TryRepair(); // Restore a moved installation before enumeration; synthetic QA never writes the registry.
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
 nint SceneCreate(string name,int width,int height){var scene=Need(Obs.obs_scene_create_private(name),"Szene konnte nicht erstellt werden.");ownedScenes.Add(scene);var source=Obs.obs_scene_get_source(scene);var settings=Obs.obs_source_get_settings(source);var patch=Settings(new{custom_size=true,cx=width,cy=height});try{Obs.obs_data_apply(settings,patch);Obs.obs_source_load(source);}finally{Obs.obs_data_release(patch);Obs.obs_data_release(settings);}return scene;}
 void CaptureItem(string source,nint item,bool visible=true){if(!captureItems.TryGetValue(source,out var items))captureItems[source]=items=new();items.Add((item,visible));}
 static string CaptureKind(string type)=>type switch{"camera" or "dshow_input"=>"camera","game" or "window" or "screen" or "game_capture" or "window_capture" or "monitor_capture" or "display_capture"=>"game",_=>""};
 static bool OwnCamera(string target)=>Enumerable.Range(1,2).Any(slot=>target.Contains(CameraRegistration.Id(slot),StringComparison.OrdinalIgnoreCase)||target.Contains(slot==1?"Batto TikTok":"Batto Twitch",StringComparison.OrdinalIgnoreCase));
 void ValidateCameras(JsonNode selected){
  // Validate every slot before creating a capture: an incomplete or duplicate
  // selection must not briefly open the first camera and then fail on the next.
  foreach(string id in CameraIds){var source=selected[id];if(!B(source,"enabled"))continue;string target=S(source,"target").Trim();
   if(target.Length==0)throw new InvalidOperationException("Bitte für jede eingeschaltete Kamera ein Gerät auswählen.");
   if(OwnCamera(target))throw new InvalidOperationException("Die eigenen virtuellen Batto-Kameras können nicht als Kameraquelle verwendet werden.");
   if(!cameraTargets.TryAdd(target,id))throw new InvalidOperationException("Jede eingeschaltete Kamera braucht ein anderes Gerät.");
  }
 }
 string ImportedCamera(JsonNode source){
  string shared=S(source,"shared");if(shared is "camera2" or "camera3")return shared;
  string target=S(source["settings"],"video_device_id").Trim();
  // Match only cameras the user explicitly enabled. Old shared:camera exports
  // retain their primary-camera fallback; imported devices never open themselves.
  return target.Length>0&&cameraTargets.TryGetValue(target,out var slot)?slot:"camera";
 }
 void ImportCollection(JsonNode? collection){
  if(collection is not JsonObject)return;
  var definitions=new Dictionary<string,JsonNode>();var inputs=new Dictionary<string,JsonNode>();
  foreach(var node in collection["scenes"]?.AsArray()??new JsonArray()){if(node==null)continue;string id=S(node,"id");if(id.Length==0||!definitions.TryAdd(id,node))throw new InvalidOperationException("OBS-Szenen enthalten doppelte oder fehlende Kennungen.");}
  foreach(var node in collection["sources"]?.AsArray()??new JsonArray()){if(node==null)continue;string id=S(node,"id");if(id.Length==0||definitions.ContainsKey(id)||!inputs.TryAdd(id,node))throw new InvalidOperationException("OBS-Quellen enthalten doppelte oder fehlende Kennungen.");}
  if(definitions.Count>256||inputs.Count>1024)throw new InvalidOperationException("Diese OBS-Sammlung ist zu groß.");
  // Validate the entire graph before creating anything: a back-edge must never
  // become an actual libobs scene reference cycle, even through hidden layers.
  var depths=new Dictionary<string,int>();var visiting=new HashSet<string>();
  int Validate(string id){if(depths.TryGetValue(id,out int done))return done;if(!visiting.Add(id))throw new InvalidOperationException("Die OBS-Sammlung enthält einen Szenenkreis.");int depth=0;foreach(var item in definitions[id]["items"]?.AsArray()??new JsonArray()){string child=S(item,"source");if(definitions.ContainsKey(child))depth=Math.Max(depth,1+Validate(child));}visiting.Remove(id);if(depth>8)throw new InvalidOperationException("Die OBS-Sammlung enthält zu tief verschachtelte Szenen.");return depths[id]=depth;}
  foreach(var id in definitions.Keys)Validate(id);
  var built=new Dictionary<string,nint>();var builtInputs=new Dictionary<string,nint>();var captureAliases=new Dictionary<string,string>();var sharedMedia=new Dictionary<string,nint>(StringComparer.OrdinalIgnoreCase);
  void Warn(string message){if(!importWarnings.Contains(message))importWarnings.Add(message);}
  nint Input(string id){
   if(builtInputs.TryGetValue(id,out var cached))return cached;
   if(!inputs.TryGetValue(id,out var node)){Warn("Eine referenzierte OBS-Quelle fehlt.");return 0;}
   string type=S(node,"type"),name=S(node,"name","OBS-Quelle"),capture=CaptureKind(type),sharedKind=S(node,"shared");
   if(capture=="camera"||capture.Length>0&&sharedKind==capture){string slot=capture=="camera"?ImportedCamera(node):capture;captureAliases[id]=slot;var shared=sources.GetValueOrDefault(slot);if(shared==0)Warn("„"+name+"“ benötigt eine eingeschaltete gemeinsame "+(capture=="camera"?(slot=="camera"?"Kamera 1.":"Kamera "+slot[^1]+"."):"Spiel-/Bildschirmquelle."));builtInputs[id]=shared;return shared;}
   var settings=(node["settings"]?.DeepClone() as JsonObject)??new JsonObject();string nativeType;string cacheKey="";
   if(capture.Length>0){
    nativeType=type switch{"camera"=>"dshow_input","game"=>"game_capture","window"=>"window_capture","screen" or "display_capture"=>"monitor_capture",_=>type};
    string target=nativeType=="dshow_input"?S(settings,"video_device_id"):nativeType=="monitor_capture"?S(settings,"monitor_id",settings["monitor"]?.ToJsonString()??""):S(settings,"window");
    bool fullscreen=nativeType=="game_capture"&&S(settings,"capture_mode")=="any_fullscreen";
    if(target.Length==0&&!fullscreen){Warn("„"+name+"“ hat kein gespeichertes Aufnahmeziel.");builtInputs[id]=0;return 0;}
    // Preserve independent windows/games (chat, browser, game), while repeated
    // references to exactly the same capture target share a single source.
    // win-capture suspends capture when none of its scene items are showing.
    if(nativeType is "game_capture" or "window_capture")settings["capture_audio"]=false;
    if(nativeType=="game_capture"){settings["capture_mode"]=fullscreen?"any_fullscreen":"window";settings["limit_framerate"]=true;}
    if(nativeType=="dshow_input"){settings["deactivate_when_not_showing"]=true;settings["use_custom_audio_device"]=false;settings["audio_device_id"]="";}
    cacheKey="capture:"+nativeType+":"+target+":"+JsonSerializer.Serialize(settings.OrderBy(p=>p.Key,StringComparer.Ordinal).ToDictionary(p=>p.Key,p=>p.Value));
   }else if(type is "image" or "image_source" or "media" or "ffmpeg_source"){
    bool video=type is "media" or "ffmpeg_source";string file=S(settings,video?"local_file":"file");
    if(!Path.IsPathFullyQualified(file)||!File.Exists(file)){Warn("Lokale Mediendatei fehlt: „"+name+"“.");builtInputs[id]=0;return 0;}
    if(video){nativeType="ffmpeg_source";LoadModule("obs-ffmpeg");settings["is_local_file"]=true;settings["input"]="";settings["input_format"]="";settings["ffmpeg_options"]="";settings["hw_decode"]=true;settings["close_when_inactive"]=true;settings["restart_on_activate"]=true;}
    else{nativeType="image_source";settings["unload"]=true;}
    cacheKey=nativeType+":"+Path.GetFullPath(file)+(video?":"+B(settings,"looping")+":"+N(settings,"speed_percent",100):"");
   }else if(type is "text" or "text_gdiplus" or "text_gdiplus_v2" or "text_gdiplus_v3" or "text_ft2_source"){nativeType="text_gdiplus";settings["read_from_file"]=false;settings["file"]="";}
   else if(type is "color" or "color_source" or "color_source_v3")nativeType="color_source";
   else{Warn("„"+name+"“: Dieser OBS-Quellentyp wird nicht übernommen.");builtInputs[id]=0;return 0;}
   if(cacheKey.Length>0&&sharedMedia.TryGetValue(cacheKey,out cached)){builtInputs[id]=cached;return cached;}
   try{var input=Source(nativeType,"OBS: "+name,settings);Obs.obs_source_set_audio_mixers(input,0);Obs.obs_source_set_muted(input,true);sources["obs:"+id]=input;if(nativeType=="ffmpeg_source")videoSources.Add(input);builtInputs[id]=input;if(cacheKey.Length>0)sharedMedia[cacheKey]=input;return input;}
   catch(InvalidOperationException){Warn("„"+name+"“ konnte nicht als OBS-Quelle geladen werden.");builtInputs[id]=0;return 0;}
  }
  nint Build(string id){
   if(built.TryGetValue(id,out var ready))return ready;
   var definition=definitions[id];int width=(int)Math.Clamp(N(definition,"width",1920),16,16384),height=(int)Math.Clamp(N(definition,"height",1080),16,16384);
   var scene=SceneCreate("OBS: "+S(definition,"name",id),width,height);built[id]=scene;
   // OBS serializes items bottom to top; adding in that order preserves layering.
   foreach(var layer in definition["items"]?.AsArray()??new JsonArray()){
    if(layer==null)continue;string sourceId=S(layer,"source");nint input=definitions.ContainsKey(sourceId)?Obs.obs_scene_get_source(Build(sourceId)):Input(sourceId);if(input==0)continue;
    var item=Need(Obs.obs_scene_add(scene,input),"OBS-Ebene konnte nicht eingefügt werden.");
    var pos=new Obs.Vec((float)N(layer["pos"],"x"),(float)N(layer["pos"],"y"));var scale=new Obs.Vec((float)N(layer["scale"],"x",1),(float)N(layer["scale"],"y",1));var bounds=new Obs.Vec((float)N(layer["bounds"],"x"),(float)N(layer["bounds"],"y"));
    var crop=new Obs.Crop{left=(int)Math.Max(0,N(layer,"crop_left")),top=(int)Math.Max(0,N(layer,"crop_top")),right=(int)Math.Max(0,N(layer,"crop_right")),bottom=(int)Math.Max(0,N(layer,"crop_bottom"))};
    Obs.obs_sceneitem_set_alignment(item,(uint)N(layer,"align",5));Obs.obs_sceneitem_set_pos(item,ref pos);Obs.obs_sceneitem_set_scale(item,ref scale);Obs.obs_sceneitem_set_rot(item,(float)N(layer,"rot"));Obs.obs_sceneitem_set_crop(item,ref crop);
    // No guessed dimensions: OBS_BOUNDS_NONE keeps raw scale against the actual
    // media dimensions, including files whose first decoded frame arrives later.
    Obs.obs_sceneitem_set_bounds_type(item,(int)Math.Clamp(N(layer,"bounds_type"),0,6));Obs.obs_sceneitem_set_bounds_alignment(item,(uint)N(layer,"bounds_align"));Obs.obs_sceneitem_set_bounds_crop(item,B(layer,"bounds_crop"));Obs.obs_sceneitem_set_bounds(item,ref bounds);
    bool visible=B(layer,"visible",true);Obs.obs_sceneitem_set_visible(item,visible);
    if(inputs.TryGetValue(sourceId,out var source)){string capture=captureAliases.GetValueOrDefault(sourceId,CaptureKind(S(source,"type")));if(capture.Length>0)CaptureItem(capture,item,visible);}
   }
   return scene;
  }
  foreach(var pair in destinations){
   var d=pair.Value;var wrappers=new Dictionary<string,nint>();
   nint Wrapped(string id){if(wrappers.TryGetValue(id,out var existing))return existing;var wrapper=SceneCreate("OBS-Ausgabe "+pair.Key+" "+id,d.width,d.height);wrappers[id]=wrapper;var item=Obs.obs_scene_add(wrapper,Obs.obs_scene_get_source(Build(id)));var size=new Obs.Vec(d.width,d.height);Obs.obs_sceneitem_set_alignment(item,5);Obs.obs_sceneitem_set_bounds_type(item,2);Obs.obs_sceneitem_set_bounds_alignment(item,0);Obs.obs_sceneitem_set_bounds(item,ref size);return wrapper;}
   foreach(var definition in definitions.Values.Where(n=>!B(n,"internal"))){
    string id=S(definition,"id"),resolved=id,partner=S(definition,"partnerId");
    if(S(definition,"platform")!=pair.Key&&definitions.TryGetValue(partner,out var other)&&S(other,"platform")==pair.Key)resolved=partner;
    string key="obs:"+id;d.scenes[key]=Wrapped(resolved);d.sceneLabels[key]=S(definitions[resolved],"name",resolved);
   }
   foreach(string alias in new[]{"Spiel","Start","Pause","Ende"}){string id=S(collection["aliases"]?[pair.Key],alias);if(definitions.ContainsKey(id)){d.scenes[alias]=Wrapped(id);d.sceneLabels[alias]=S(definitions[id],"name",id);}}
  }
 }
 public object Prepare(JsonNode config,bool test=false){
  if(destinations.Values.Any(d=>d.camera!=null||d.output!=0&&Obs.obs_output_active(d.output)))throw new InvalidOperationException("Erst beide Ausgaben stoppen.");
  Reset();
  try{
   foreach(var definition in config["transitions"]?.AsArray()??new JsonArray()){
    if(definition==null)continue;string id=S(definition,"id");
    if(id.Length==0||id is "cut" or "fade"||transitionDefinitions.Count>=64||!transitionDefinitions.TryAdd(id,definition.DeepClone()))throw new InvalidOperationException("Ungültige oder doppelte OBS-Übergänge.");
   }
   var selected=config["sources"]!;
   ValidateCameras(selected);
   if(test){sources["game"]=Source("color_source","Gemeinsames Testbild",new{color=0xFF603CB0,width=1280,height=720});sources["camera"]=Source("color_source","Kameraplatzhalter für Test",new{color=0xFF35C5EE,width=640,height=480});foreach(string id in CameraIds.Skip(1))if(B(selected[id],"enabled"))sources[id]=Source("color_source","Kameraplatzhalter "+id,new{color=id=="camera2"?0xFF41C828u:0xFFF04949u,width=640,height=480});}
   else {
    foreach(string name in new[]{"game","camera","camera2","camera3","microphone","desktop"}){
     var s=selected[name];if(!B(s,"enabled"))continue;string target=S(s,"target");
     if(name=="game"){
      var kind=S(s,"kind","game");
      sources[name]=kind switch{
       "screen"=>Source("monitor_capture","Gemeinsamer Bildschirm",new{monitor_id=target,capture_cursor=true}),
       "window"=>Source("window_capture","Gemeinsames Fenster",new{window=target,priority=0,cursor=true}),
       _=>Source("game_capture","Gemeinsames Spiel",new{capture_mode="window",window=target,priority=0,limit_framerate=true,capture_cursor=true})};
     }else if(CameraIds.Contains(name))sources[name]=Source("dshow_input","Gemeinsame Kamera "+(name=="camera"?"1":name[^1].ToString()),new{video_device_id=target,res_type=0,deactivate_when_not_showing=true,use_custom_audio_device=false,audio_device_id=""});
     else{sources[name]=Source(name=="microphone"?"wasapi_input_capture":"wasapi_output_capture",name=="microphone"?"Gemeinsames Mikrofon":"Gemeinsamer PC-Ton",new{device_id=target});Obs.obs_source_set_audio_mixers(sources[name],3);Obs.obs_set_output_source(name=="microphone"?1u:2u,sources[name]);}
    }
   }
   // Background-only scenes remain usable without opening a physical camera.
   // Audio comes exclusively from the explicitly enabled microphone / desktop inputs.
   // A camera or game plugin must not silently add another audio source.
   foreach(var s in sources)Obs.obs_source_set_audio_mixers(s.Value,s.Key is "microphone" or "desktop"?3u:0u);
   bool hd=S(config,"profile")=="fullhd_1080p30";
   foreach(string platform in new[]{"tiktok","twitch"}){
    var d=new Destination{width=platform=="tiktok"?(hd?1080:720):(hd?1920:1280),height=platform=="tiktok"?(hd?1920:1280):(hd?1080:720),bitrate=platform=="tiktok"?(hd?6000:3200):(hd?4500:3000)};destinations[platform]=d;
    d.scene=SceneCreate("Batto "+platform,d.width,d.height);
    var gameScene=SceneCreate("Spiel "+platform,d.width,d.height);d.scenes["Spiel"]=gameScene;d.sourceScene=gameScene;
    foreach(var item in config["layouts"]![platform]!.AsArray()){
     string source=S(item,"source");if(!B(item,"visible",true)||!sources.TryGetValue(source,out var input))continue;
     nint sceneItem=Need(Obs.obs_scene_add(gameScene,input),"Quelle konnte nicht eingefügt werden.");
     CaptureItem(source,sceneItem);var pos=new Obs.Vec((float)N(item,"x")*d.width,(float)N(item,"y")*d.height);var size=new Obs.Vec((float)N(item,"width",1)*d.width,(float)N(item,"height",1)*d.height);
     Obs.obs_sceneitem_set_alignment(sceneItem,5);Obs.obs_sceneitem_set_pos(sceneItem,ref pos);Obs.obs_sceneitem_set_bounds_type(sceneItem,S(item,"fit")=="cover"?3:2);Obs.obs_sceneitem_set_bounds_alignment(sceneItem,0);Obs.obs_sceneitem_set_bounds_crop(sceneItem,true);Obs.obs_sceneitem_set_bounds(sceneItem,ref size);
    }
    foreach(string name in new[]{"Pause","Start","Ende"}){
     var stage=SceneCreate(name+" "+platform,d.width,d.height);d.scenes[name]=stage;
     var platformBackgrounds=config["program"]?["platformBackgrounds"]?[platform] as JsonObject;
     string file=platformBackgrounds?.ContainsKey(name)==true?S(platformBackgrounds,name):S(config["program"]?["backgrounds"],name);
     if(!string.IsNullOrEmpty(file)&&File.Exists(file)){
      var extension=Path.GetExtension(file).ToLowerInvariant();bool video=new[]{".mp4",".webm",".mkv",".mov",".m4v",".avi"}.Contains(extension);
      if(!video&&!new[]{".png",".jpg",".jpeg",".webp",".bmp",".gif"}.Contains(extension))throw new InvalidOperationException("Dieses Hintergrundformat wird nicht unterstützt.");
      string id="background-"+platform+"-"+name;
      // Reuse identical local backgrounds across both canvases. A video is decoded once.
      var shared=backgroundSources.GetValueOrDefault(file);
      if(shared==0){if(video)LoadModule("obs-ffmpeg");shared=Source(video?"ffmpeg_source":"image_source",name+" Hintergrund "+platform,video?(object)new{local_file=file,is_local_file=true,looping=true,hw_decode=true,restart_on_activate=true,close_when_inactive=true}:new{file,unload=true});Obs.obs_source_set_audio_mixers(shared,0);backgroundSources[file]=shared;sources[id]=shared;}
      var item=Obs.obs_scene_add(stage,shared);var size=new Obs.Vec(d.width,d.height);Obs.obs_sceneitem_set_bounds_type(item,2);Obs.obs_sceneitem_set_bounds(item,ref size);
     }
    }
    d.transition=Source("fade_transition","Übergang "+platform,new{});Obs.obs_transition_set_size(d.transition,(uint)d.width,(uint)d.height);
    d.selected=S(config["program"],"scene","Spiel");if(!d.scenes.ContainsKey(d.selected))d.selected="Spiel";
    Obs.obs_transition_set(d.transition,Obs.obs_scene_get_source(d.scenes[d.selected]));d.transitionItem=Obs.obs_scene_add(d.scene,d.transition);
    foreach(string kind in new[]{"chat","events"}){
     var text=Source("text_gdiplus",kind+" "+platform,new{text="",font=new{face="Segoe UI",size=Math.Max(24,d.width/32),flags=0},color=0xFFFFFF,outline=true,outline_size=2,bk_color=0x121212,bk_opacity=70,extents=true,extents_cx=(int)(d.width*.94),extents_cy=(int)(d.height*(kind=="chat"?.20:.10)),word_wrap=true});
     var item=Obs.obs_scene_add(d.scene,text);var pos=new Obs.Vec(d.width*.03f,d.height*(kind=="chat"?.67f:.88f));var size=new Obs.Vec(d.width*.94f,d.height*(kind=="chat"?.20f:.10f));
     Obs.obs_sceneitem_set_alignment(item,5);Obs.obs_sceneitem_set_pos(item,ref pos);Obs.obs_sceneitem_set_bounds_type(item,2);Obs.obs_sceneitem_set_bounds(item,ref size);Obs.obs_sceneitem_set_visible(item,false);
     if(kind=="chat"){d.chat=text;d.chatItem=item;}else{d.events=text;d.eventItem=item;}
    }
    d.view=Need(Obs.obs_view_create(),"Videoansicht konnte nicht erstellt werden.");Obs.obs_view_set_source(d.view,0,Obs.obs_scene_get_source(d.scene));
   }
   ImportCollection(config["obsCollection"]);
   foreach(var d in destinations.Values){string requested=S(config["program"],"scene","Spiel");d.selected=d.scenes.ContainsKey(requested)?requested:"Spiel";Obs.obs_transition_set(d.transition,Obs.obs_scene_get_source(d.scenes[d.selected]));}
   prepared=true;return Status();
  }catch{Reset();throw;}
 }
 (string NativeType,JsonObject Settings) TransitionSettings(string id){
  if(id is "cut" or "fade")return ("fade_transition",new JsonObject());
  if(!transitionDefinitions.TryGetValue(id,out var definition))throw new InvalidOperationException("Dieser OBS-Übergang ist nicht importiert.");
  var input=definition["settings"];string type=S(definition,"type");
  if(type!="stinger")throw new InvalidOperationException("Dieser OBS-Übergang wird nicht unterstützt.");
  string name=S(definition,"name","Stinger"),file=S(input,"path");
  string LocalFile(string value){if(!Path.IsPathFullyQualified(value)||value.StartsWith(@"\\")||!File.Exists(value))throw new InvalidOperationException("Die lokale Videodatei für den Übergang „"+name+"“ fehlt. Bitte neu zuordnen.");return Path.GetFullPath(value);}
  // Never forward arbitrary media/decoder settings from an imported document.
  // Full-video RAM preloading and local audio monitoring are deliberately off.
  var settings=new JsonObject{["path"]=LocalFile(file),["transition_point"]=(int)Math.Clamp(N(input,"transition_point"),0,120000),["tp_type"]=N(input,"tp_type")==1?1:0,["hw_decode"]=B(input,"hw_decode",true),["preload"]=false,["enable_monitoring"]=false,["audio_monitoring"]=0,["audio_fade_style"]=N(input,"audio_fade_style")==1?1:0,["track_matte_enabled"]=B(input,"track_matte_enabled"),["track_matte_layout"]=(int)Math.Clamp(N(input,"track_matte_layout"),0,3),["invert_matte"]=B(input,"invert_matte")};
  if(B(settings,"track_matte_enabled")&&N(settings,"track_matte_layout")==2)settings["track_matte_path"]=LocalFile(S(input,"track_matte_path"));
  return ("obs_stinger_transition",settings);
 }
 static void ReplaceTransition(Destination d,nint next,string id){
  var nextItem=Need(Obs.obs_scene_add(d.scene,next),"Übergang konnte nicht eingefügt werden.");
  // Keep the program picture below chat, event and temporary media overlays.
  Obs.obs_sceneitem_set_order_position(nextItem,0);Obs.obs_sceneitem_remove(d.transitionItem);Obs.obs_source_release(d.transition);d.transition=next;d.transitionItem=nextItem;d.transitionId=id;
 }
 void ReleaseFinishedTransition(Destination d){
  if(d.transition==0||d.transitionId=="fade"||Obs.obs_transition_get_time(d.transition)<1)return;
  nint next=0;
  try{
   // Stinger preloads its first frame again at the end. Release its decoder
   // entirely while idle; the selected transition remains in desktop config.
   next=Source("fade_transition","Ruhendes Szenenbild",new{});Obs.obs_transition_set_size(next,(uint)d.width,(uint)d.height);Obs.obs_transition_set(next,Obs.obs_scene_get_source(d.scenes[d.selected]));ReplaceTransition(d,next,"fade");next=0;
  }catch{if(next!=0)Obs.obs_source_release(next);} // Keep the current picture if allocation fails.
 }
 public object Scene(string name,string transition,int duration,string platform="both"){
  if(!prepared||duration<100||duration>2000||!new[]{"both","tiktok","twitch"}.Contains(platform)||destinations.Where(x=>platform=="both"||x.Key==platform).Any(x=>!x.Value.scenes.ContainsKey(name)))throw new InvalidOperationException("Ungültige Szene oder Übergang.");
  var spec=TransitionSettings(transition);string resourceId=transition=="cut"?"fade":transition;
  var targets=destinations.Where(x=>platform=="both"||x.Key==platform).ToArray();
  // Validate both canvases before either changes. A quick second press must not
  // leave TikTok and Twitch at different points in the same Stinger video.
  if(transition!="cut"&&targets.Any(x=>Obs.obs_transition_is_active(x.Value.transition)&&Obs.obs_transition_get_time(x.Value.transition)<1))throw new InvalidOperationException("Übergang läuft noch. Bitte kurz warten.");
  var replacements=new Dictionary<Destination,nint>();
  try{
   foreach(var pair in targets){var d=pair.Value;if(d.transitionId==resourceId)continue;
    if(spec.NativeType=="obs_stinger_transition"){LoadModule("obs-ffmpeg");if(!loadedModules.Contains("obs-ffmpeg"))throw new InvalidOperationException("Die Videobibliothek für Stinger-Übergänge fehlt.");}
    var next=Source(spec.NativeType,"Übergang "+pair.Key,spec.Settings);replacements[d]=next;
    Obs.obs_source_set_audio_mixers(next,0);Obs.obs_source_set_muted(next,true);
    if(spec.NativeType=="obs_stinger_transition"){
     // The decoder opens its file asynchronously. Starting too soon would use
     // a zero duration and cut at the wrong frame on the first selection.
     bool Ready(){int children=0;bool ready=true;Obs.SourceEnum inspect=(_,child,_)=>{if(Obs.Str(Obs.obs_source_get_id(child))!="ffmpeg_source")return;children++;ready&=Obs.obs_source_media_get_duration(child)>0;};Obs.obs_source_enum_full_tree(next,inspect,0);return children>0&&ready;}
     var wait=Stopwatch.StartNew();while(!Ready()&&wait.ElapsedMilliseconds<3000)Thread.Sleep(20);
     if(!Ready())throw new InvalidOperationException("Die Stinger-Videodatei konnte nicht geladen werden. Bitte Format und Datei prüfen.");
    }
    Obs.obs_transition_set_size(next,(uint)d.width,(uint)d.height);Obs.obs_transition_set(next,Obs.obs_scene_get_source(d.scenes[d.selected]));
   }
   foreach(var pair in targets){var d=pair.Value;
    if(replacements.TryGetValue(d,out var next)){ReplaceTransition(d,next,resourceId);replacements.Remove(d);}
    var target=Obs.obs_scene_get_source(d.scenes[name]);
    // OBS rejects transitioning to the same source; identical scene/alias
    // selections are successful no-ops, including paired platform aliases.
    if(transition=="cut"||d.scenes[name]==d.scenes[d.selected])Obs.obs_transition_set(d.transition,target);
    else if(!Obs.obs_transition_start(d.transition,0,(uint)duration,target))throw new InvalidOperationException("Übergang konnte nicht gestartet werden.");
    d.selected=name;
   }
  }finally{foreach(var pending in replacements.Values)Obs.obs_source_release(pending);}
  return Status();
 }
 public object Overlay(string chat,string events,bool chatVisible,bool eventsVisible){
  foreach(var d in destinations.Values){foreach(var item in new[]{(d.chat,chat),(d.events,events)}){var data=Settings(new{text=item.Item2[..Math.Min(1500,item.Item2.Length)]});try{Obs.obs_source_update(item.Item1,data);}finally{Obs.obs_data_release(data);}}Obs.obs_sceneitem_set_visible(d.chatItem,chatVisible&&!string.IsNullOrWhiteSpace(chat));Obs.obs_sceneitem_set_visible(d.eventItem,eventsVisible&&!string.IsNullOrWhiteSpace(events));}return Status();
 }
 public object SourceControl(string source,bool enabled){
  if(source is "microphone" or "desktop"){if(sources.TryGetValue(source,out var input))Obs.obs_source_set_muted(input,!enabled);}
  else if(source is "camera" or "camera2" or "camera3" or "game"){if(captureItems.TryGetValue(source,out var items))foreach(var item in items)Obs.obs_sceneitem_set_visible(item.Item,enabled&&item.Visible);}
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
 void EnsureVideo(Destination d){if(d.video!=0)return;var video=Video(d.width,d.height);d.video=Need(Obs.obs_view_add2(d.view,ref video),"Videoausgabe konnte nicht erstellt werden.");Obs.obs_source_inc_active(Obs.obs_scene_get_source(d.scene));}
 public object StartCamera(string platform){
  if(!prepared||!destinations.TryGetValue(platform,out var d))throw new InvalidOperationException("Erst Quellen vorbereiten.");
  if(d.camera!=null)throw new InvalidOperationException("Diese virtuelle Kamera läuft bereits.");
  int slot=platform=="tiktok"?1:2;if(!CameraRegistration.Ready(slot))throw new InvalidOperationException("Virtuelle Kameras erst einrichten.");
  EnsureVideo(d);try{d.camera=new VirtualCamera(d.video,d.width,d.height,slot);d.error="";}catch{Obs.obs_view_remove(d.view);Obs.obs_source_dec_active(Obs.obs_scene_get_source(d.scene));d.video=0;throw;}return Status();
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
  ReleasePreview(d);
  d.camera?.Dispose();d.camera=null;
  if(d.output!=0&&Obs.obs_output_active(d.output)){Obs.obs_output_stop(d.output);var t=Stopwatch.StartNew();while(Obs.obs_output_active(d.output)&&t.ElapsedMilliseconds<4000)Thread.Sleep(30);if(Obs.obs_output_active(d.output)){Obs.obs_output_force_stop(d.output);t.Restart();while(Obs.obs_output_active(d.output)&&t.ElapsedMilliseconds<2000)Thread.Sleep(20);}}
  d.requested=false;if(d.video!=0){Obs.obs_view_remove(d.view);Obs.obs_source_dec_active(Obs.obs_scene_get_source(d.scene));d.video=0;}
 }
 public object Mute(string platform,bool muted){uint bit=platform=="tiktok"?1u:2u;var configMix=muted?0u:bit;mixers=(mixers&~bit)|configMix;foreach(string id in new[]{"microphone","desktop"})if(sources.TryGetValue(id,out var source))Obs.obs_source_set_audio_mixers(source,mixers);if(media!=0)Obs.obs_source_set_audio_mixers(media,mixers);return Status();}
 uint mixers=3;
 public object Snapshot(string platform,string mode="program"){
  if(!prepared||!destinations.TryGetValue(platform,out var d))throw new InvalidOperationException("Erst Quellen vorbereiten.");
  if(mode is not "program" and not "sources")throw new InvalidOperationException("Unbekannte Vorschau.");
  var previewSource=Obs.obs_scene_get_source(mode=="sources"?d.sourceScene:d.scene);
  // Keep a bounded preview alive across the UI's one-second snapshots. Closing a
  // video after every frame would restart its decoder and return black forever.
  // The timer releases this graph after snapshots stop, even without commands.
  if(d.previewSource!=previewSource){ReleasePreview(d);Obs.obs_source_inc_active(previewSource);d.previewSource=previewSource;}
  d.previewDeadline=Environment.TickCount64+2500;
  if(sources.Any(s=>Obs.obs_source_get_width(s.Value)==0))Thread.Sleep(120);
  int width=d.width>d.height?640:360,height=d.width>d.height?360:640;byte[] pixels=new byte[width*height*4];nint render=0,surface=0;
  Obs.obs_enter_graphics();
  try{
   render=Need(Obs.gs_texrender_create(5,0),"Vorschaubild nicht verfügbar.");surface=Need(Obs.gs_stagesurface_create((uint)width,(uint)height,5),"Vorschaubild nicht verfügbar.");
   Obs.gs_viewport_push();Obs.gs_projection_push();Obs.gs_matrix_push();
   try{if(!Obs.gs_texrender_begin(render,(uint)width,(uint)height))throw new InvalidOperationException("Vorschaubild nicht verfügbar.");
    try{Obs.gs_matrix_identity();Obs.gs_ortho(0,d.width,0,d.height,-100,100);var black=new Obs.Color{a=1};Obs.gs_clear(1,ref black,1,0);Obs.obs_source_video_render(previewSource);}finally{Obs.gs_texrender_end(render);}
   }finally{Obs.gs_matrix_pop();Obs.gs_projection_pop();Obs.gs_viewport_pop();}
   Obs.gs_stage_texture(surface,Obs.gs_texrender_get_texture(render));
   if(!Obs.gs_stagesurface_map(surface,out var data,out uint stride))throw new InvalidOperationException("Vorschaubild konnte nicht gelesen werden.");
   try{for(int y=0;y<height;y++)Marshal.Copy(data+(int)(y*stride),pixels,y*width*4,width*4);}finally{Obs.gs_stagesurface_unmap(surface);}
  }finally{if(surface!=0)Obs.gs_stagesurface_destroy(surface);if(render!=0)Obs.gs_texrender_destroy(render);Obs.obs_leave_graphics();}
  using var bitmap=new System.Drawing.Bitmap(width,height,System.Drawing.Imaging.PixelFormat.Format32bppArgb);
  var locked=bitmap.LockBits(new System.Drawing.Rectangle(0,0,width,height),System.Drawing.Imaging.ImageLockMode.WriteOnly,System.Drawing.Imaging.PixelFormat.Format32bppArgb);
  try{for(int y=0;y<height;y++)Marshal.Copy(pixels,y*width*4,locked.Scan0+y*locked.Stride,width*4);}finally{bitmap.UnlockBits(locked);}
  using var stream=new MemoryStream();bitmap.Save(stream,System.Drawing.Imaging.ImageFormat.Png);return new{image="data:image/png;base64,"+Convert.ToBase64String(stream.ToArray()),width,height,mode,scene=d.selected,sources=sources.Select(s=>new{id=s.Key,width=Obs.obs_source_get_width(s.Value),height=Obs.obs_source_get_height(s.Value)}).ToArray(),capturedAt=DateTimeOffset.UtcNow};
 }
 public object TestMediaState()=>sources.Where(s=>videoSources.Contains(s.Value)).Select(s=>new{id=s.Key,active=Obs.obs_source_active(s.Value),milliseconds=Obs.obs_source_media_get_time(s.Value)}).ToArray();
 public object TestTransitionState()=>destinations.ToDictionary(pair=>pair.Key,pair=>{
  var children=new List<object>();Obs.SourceEnum inspect=(_,child,_)=>{if(Obs.Str(Obs.obs_source_get_id(child))=="ffmpeg_source")children.Add(new{active=Obs.obs_source_active(child),milliseconds=Obs.obs_source_media_get_time(child),duration=Obs.obs_source_media_get_duration(child)});};
  Obs.obs_source_enum_full_tree(pair.Value.transition,inspect,0);return new{id=pair.Value.transitionId,children};
 });
 public object Status()=>new{prepared,encoder,virtualCameras=CameraRegistration.Status(),version=Obs.Str(Obs.obs_get_version_string()),sourceCount=sources.Values.Distinct().Count(),importWarnings=importWarnings.ToArray(),sceneCount=ownedScenes.Count,overlays=destinations.ToDictionary(x=>x.Key,x=>new{chatWidth=Obs.obs_source_get_width(x.Value.chat),eventWidth=Obs.obs_source_get_width(x.Value.events)}),
  sources=sources.Select(s=>new{id=s.Key,width=Obs.obs_source_get_width(s.Value),height=Obs.obs_source_get_height(s.Value),active=Obs.obs_source_active(s.Value)}),
  renderedFrames=Obs.obs_get_total_frames(),laggedFrames=Obs.obs_get_lagged_frames(),
  outputs=destinations.ToDictionary(x=>x.Key,x=>{var d=x.Value;bool active=d.output!=0&&Obs.obs_output_active(d.output);ulong bytes=d.output==0?0:Obs.obs_output_get_total_bytes(d.output);if(d.requested&&!active)d.error="Ausgabe beendet oder Verbindung fehlgeschlagen. Sendezugang und Netzwerk prüfen.";return (object)new{cameraName=CameraRegistration.Name(x.Key=="tiktok"?1:2),scene=d.selected,sceneLabel=d.sceneLabels.GetValueOrDefault(d.selected,d.selected),transition=d.transitionId,transitionActive=Obs.obs_transition_is_active(d.transition)&&Obs.obs_transition_get_time(d.transition)<1,d.width,d.height,d.bitrate,state=d.camera!=null?"camera":d.requested?(active?(bytes>0?(d.recording?"test":"live"):"connecting"):"error"):"stopped",bytes,frames=d.camera?.Frames??(d.output==0?0:Obs.obs_output_get_total_frames(d.output)),droppedFrames=d.output==0?0:Obs.obs_output_get_frames_dropped(d.output),error=d.error,muted=(mixers&(x.Key=="tiktok"?1:2))==0};})};
 static void ReleaseOutput(Destination d){StopOutput(d);if(d.output!=0)Obs.obs_output_release(d.output);if(d.service!=0)Obs.obs_service_release(d.service);if(d.videoEncoder!=0)Obs.obs_encoder_release(d.videoEncoder);if(d.audioEncoder!=0)Obs.obs_encoder_release(d.audioEncoder);d.output=d.service=d.videoEncoder=d.audioEncoder=0;}
 void Reset(){ClearMedia();prepared=false;foreach(var d in destinations.Values){ReleaseOutput(d);if(d.view!=0){Obs.obs_view_remove(d.view);Obs.obs_view_set_source(d.view,0,0);Obs.obs_view_destroy(d.view);}if(d.transition!=0)Obs.obs_source_release(d.transition);if(d.chat!=0)Obs.obs_source_release(d.chat);if(d.events!=0)Obs.obs_source_release(d.events);}destinations.Clear();foreach(var scene in ownedScenes)Obs.obs_scene_release(scene);ownedScenes.Clear();captureItems.Clear();cameraTargets.Clear();importWarnings.Clear();transitionDefinitions.Clear();Obs.obs_set_output_source(1,0);Obs.obs_set_output_source(2,0);foreach(var s in sources.Values.Distinct())Obs.obs_source_release(s);sources.Clear();backgroundSources.Clear();videoSources.Clear();mixers=3;}
 public void Dispose(){lock(Sync){if(disposed)return;disposed=true;previewTimer.Dispose();if(started){Reset();Obs.obs_shutdown();started=false;}if(graphics!=0){Marshal.FreeCoTaskMem(graphics);graphics=0;}}}
}

internal static class Program {
 [STAThread] static int Main(string[] args){
  if(args.Any(a=>a is "--register-cameras" or "--unregister-cameras" or "--setup-cameras" or "--register-cameras-system" or "--unregister-cameras-system")){
   try{
    if(args.Contains("--setup-cameras"))CameraRegistration.Setup();
    else if(args.Contains("--register-cameras-system")){var index=Array.IndexOf(args,"--register-cameras-system");CameraRegistration.RegisterSystem(index+1<args.Length?args[index+1]:null);}
    else if(args.Contains("--unregister-cameras-system"))CameraRegistration.Unregister(true);
    else if(args.Contains("--register-cameras"))CameraRegistration.Register();else CameraRegistration.Unregister();
    Console.WriteLine(JsonSerializer.Serialize(CameraRegistration.Status()));return 0;
   }catch(Exception e){Console.Error.WriteLine(e.Message);return 1;}
  }
  Console.InputEncoding=new System.Text.UTF8Encoding(false);Console.OutputEncoding=new System.Text.UTF8Encoding(false);
  using var engine=new Engine(args.Length>0?args[0]:"");
  try{engine.Initialize();Console.WriteLine("BATTO_JSON:"+JsonSerializer.Serialize(new{ready=true}));}
  catch(Exception e){Console.WriteLine("BATTO_JSON:"+JsonSerializer.Serialize(new{ready=false,error=e is InvalidOperationException?e.Message:"OBS-Bibliotheken konnten nicht geladen werden."}));return 1;}
  string? line;
  while((line=Console.ReadLine())!=null){
   JsonNode? req=null;try{
    lock(engine.Sync){req=JsonNode.Parse(line);var command=req?["command"]?.GetValue<string>();object? result=command switch{
     "probe"=>engine.Probe(),"status"=>engine.Status(),"prepare"=>engine.Prepare(req!["config"]!),
     "start"=>engine.Start(req!["platform"]!.GetValue<string>(),req["server"]?.GetValue<string>(),req["key"]?.GetValue<string>()),
     "camera-start"=>engine.StartCamera(req!["platform"]!.GetValue<string>()),
     "stop"=>engine.Stop(req!["platform"]!.GetValue<string>()),"mute"=>engine.Mute(req!["platform"]!.GetValue<string>(),req["muted"]!.GetValue<bool>()),
     "scene"=>engine.Scene(req!["scene"]!.GetValue<string>(),req["transition"]!.GetValue<string>(),req["durationMs"]!.GetValue<int>(),req["platform"]?.GetValue<string>()??"both"),
     "overlay"=>engine.Overlay(req!["chat"]!.GetValue<string>(),req["events"]!.GetValue<string>(),req["chatVisible"]!.GetValue<bool>(),req["eventsVisible"]!.GetValue<bool>()),
     "source"=>engine.SourceControl(req!["source"]!.GetValue<string>(),req["enabled"]!.GetValue<bool>()),
     "media"=>engine.Media(req!["path"]!.GetValue<string>(),req["volume"]?.GetValue<double>()??1,req["duration"]?.GetValue<int>()??30),
     "media-state"=>engine.MediaState(),"media-stop"=>engine.MediaStop(),
     "snapshot"=>engine.Snapshot(req!["platform"]!.GetValue<string>(),req["mode"]?.GetValue<string>()??"program"),
     "test-prepare" when Environment.GetEnvironmentVariable("BATTO_DUAL_TEST")=="1"=>engine.Prepare(req!["config"]!,true),
     "test-media-state" when Environment.GetEnvironmentVariable("BATTO_DUAL_TEST")=="1"=>engine.TestMediaState(),
     "test-transition-state" when Environment.GetEnvironmentVariable("BATTO_DUAL_TEST")=="1"=>engine.TestTransitionState(),
     "test-record" when Environment.GetEnvironmentVariable("BATTO_DUAL_TEST")=="1"=>engine.Start(req!["platform"]!.GetValue<string>(),null,null,req["path"]!.GetValue<string>()),
     "quit"=>null,_=>throw new InvalidOperationException("Unbekannte Video-Aktion.")};
    Console.WriteLine("BATTO_JSON:"+JsonSerializer.Serialize(new{id=req?["id"]?.GetValue<int>(),ok=true,result}));if(command=="quit")break;}
   }catch(Exception e){Console.WriteLine("BATTO_JSON:"+JsonSerializer.Serialize(new{id=req?["id"]?.GetValue<int>(),ok=false,error=Environment.GetEnvironmentVariable("BATTO_DUAL_TEST")=="1"?e.ToString():e is InvalidOperationException?e.Message:"Video-Aktion fehlgeschlagen."}));}
  }return 0;
 }
}
