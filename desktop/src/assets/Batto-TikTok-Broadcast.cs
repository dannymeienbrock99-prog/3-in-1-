using System;
using Newtonsoft.Json;

public class CPHInline
{
    public bool Execute()
    {
        string message;
        if (!CPH.TryGetArg("message", out message) || String.IsNullOrWhiteSpace(message)) return false;
        // Official TikFinity Streamer.bot integration payload.
        CPH.WebsocketBroadcastJson(JsonConvert.SerializeObject(new {
            action = "sendChatbotMessage",
            args = new { message = message }
        }));
        return true;
    }
}
