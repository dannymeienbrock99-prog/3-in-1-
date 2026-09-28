using System;
using Newtonsoft.Json;

// Add as the LAST sub-action in a Streamer.bot action invoked by Batto.
// Only reaches this point when the preceding sub-actions have completed.
public class CPHInline
{
    public bool Execute()
    {
        string runId;
        string actionId;
        if (!CPH.TryGetArg("battoRunId", out runId) || String.IsNullOrWhiteSpace(runId)) return false;
        if (!CPH.TryGetArg("battoActionId", out actionId) || String.IsNullOrWhiteSpace(actionId)) return false;
        CPH.WebsocketBroadcastJson(JsonConvert.SerializeObject(new {
            batto = new { kind = "completion", runId = runId, actionId = actionId, ok = true }
        }));
        return true;
    }
}
