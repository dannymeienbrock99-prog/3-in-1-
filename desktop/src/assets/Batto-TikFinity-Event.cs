using System;
using Newtonsoft.Json;

public class CPHInline
{
    private string Text(string name) { object value; return CPH.TryGetArg(name, out value) ? Convert.ToString(value) : ""; }
    private double Number(string name) { double value; return Double.TryParse(Text(name), System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out value) ? value : 0; }
    public bool Execute()
    {
        // In each action set battoEventType to gift, follow, like, share or sub.
        string type = Text("battoEventType").ToLowerInvariant();
        if (type != "gift" && type != "follow" && type != "like" && type != "share" && type != "sub") return false;
        string eventId = Text("eventId");
        if (String.IsNullOrWhiteSpace(eventId)) eventId = Text("msgId");
        if (String.IsNullOrWhiteSpace(eventId)) eventId = Text("battoEventId");
        if (String.IsNullOrWhiteSpace(eventId))
        {
            CPH.LogWarn("Batto: TikFinity-Event ohne Quell-ID. Nicht ausgeführt, damit Wiederholungen keine doppelten Unterstützungen auslösen. Quelle/Bridge-Kontext prüfen.");
            return false;
        }
        // 'coins' already describes the received coin value. Never multiply it by repeatCount.
        double count = type == "like" ? Number("likeCount") : type == "gift" ? Number("repeatCount") : 1;
        if (count <= 0) count = 1;
        CPH.WebsocketBroadcastJson(JsonConvert.SerializeObject(new {
            batto = new {
                kind = "event", platform = "tiktok", type = type, eventId = eventId,
                username = Text("username"), userId = Text("userId"), nickname = Text("nickname"),
                giftId = Text("giftId"), giftName = Text("giftName"), count = count,
                value = type == "gift" ? Number("coins") : count
            }
        }));
        return true;
    }
}
