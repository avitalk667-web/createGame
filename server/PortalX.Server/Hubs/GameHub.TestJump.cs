using Microsoft.AspNetCore.SignalR;

namespace PortalX.Server.Hubs;

/// <summary>TESTING ONLY: a local preview may jump to a later room (Game:TestJumps). Always refused in Production.</summary>
public sealed partial class GameHub
{
    public Task<HubResult> TestJump(string zone)
    {
        var env = Context.GetHttpContext()!.RequestServices.GetRequiredService<IWebHostEnvironment>();
        if (env.IsProduction() || !rooms.Engine.TestJumpsEnabled)
            return Task.FromResult(new HubResult(false, "not-allowed", "מעבר בין חדרים זמין רק בסביבת בדיקה."));
        return Run("test-jump", null, (room, pid) => rooms.Engine.TestJump(room, pid, zone ?? "", DateTime.UtcNow),
            new System.Text.Json.Nodes.JsonObject { ["zone"] = zone });
    }
}
