using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using PortalX.Server.Data;
using PortalX.Server.Domain;
using PortalX.Server.Game;

namespace PortalX.Server.Hubs;

public sealed record HubResult(bool Ok, string Code, string Message, JsonNode? Data = null, RoomSnapshot? Snapshot = null);

/// <summary>
/// Real-time channel (spec §11 SignalR): joining, readiness, player moves, puzzle events, hints, items, chat and reconnects.
/// The server is the source of truth; clients only send intents.
/// </summary>
public sealed class GameHub(RoomService rooms, RoomRuntime runtime, PortalDbContext db, ILogger<GameHub> logger) : Hub
{
    private Guid? PlayerId => Context.Items.TryGetValue("player", out var v) ? (Guid?)v : null;
    private Guid? RoomId => Context.Items.TryGetValue("room", out var v) ? (Guid?)v : null;
    private static string Group(Guid roomId) => "room:" + roomId;

    public async Task<HubResult> Connect(string token)
    {
        if (!Allow("connect", 10, 60)) return TooFast();
        var player = await rooms.FindPlayerByTokenAsync(token ?? "");
        if (player == null) return new HubResult(false, "bad-token", "לא מצאנו את השחקן. הצטרפו מחדש בעזרת קוד החדר.");

        var exec = await rooms.ExecuteAsync(player.RoomId, player.Id, "connect", null, null, room =>
        {
            var p = GameEngine.FindPlayer(room, player.Id);
            if (p == null) return ActionOutcome.Fail("not-in-room", "השחקן הוסר מהחדר.");
            var wasConnected = p.IsConnected;
            p.IsConnected = true;
            p.ConnectionId = Context.ConnectionId;
            p.LastSeenAt = DateTime.UtcNow;
            return new ActionOutcome(true, "ok", "", wasConnected ? [] : [new GameNotice("player-connected", $"{p.Nickname} התחבר", p.Id.ToString())], true);
        });
        if (!exec.Outcome.Ok) return new HubResult(false, exec.Outcome.Code, exec.Outcome.Message);

        Context.Items["player"] = player.Id;
        Context.Items["room"] = player.RoomId;
        await Groups.AddToGroupAsync(Context.ConnectionId, Group(player.RoomId));
        await Broadcast(exec, exceptCaller: true);

        var data = new JsonObject
        {
            ["playerId"] = player.Id.ToString(),
            ["chat"] = JsonSerializer.SerializeToNode(runtime.Chat(player.RoomId), Content.ScenarioCatalog.JsonOptions),
            ["positions"] = JsonSerializer.SerializeToNode(runtime.Positions(player.RoomId).ToDictionary(k => k.Key.ToString(), v => v.Value), Content.ScenarioCatalog.JsonOptions),
        };
        return new HubResult(true, "ok", "", data, exec.Snapshot);
    }

    public Task<HubResult> SetReady(bool ready) => Run("ready", null, (room, pid) => rooms.Engine.SetReady(room, pid, ready));

    public Task<HubResult> UpdateProfile(string characterId, string appearanceJson) =>
        Run("profile", null, (room, pid) => rooms.Engine.UpdateProfile(room, pid, characterId, appearanceJson));

    public Task<HubResult> StartGame() => Run("start", null, (room, pid) => rooms.Engine.StartGame(room, pid, DateTime.UtcNow));

    public Task<HubResult> FinishIntro(bool skip) => Run("intro-finished", null, (room, pid) => rooms.Engine.FinishIntro(room, pid, skip, DateTime.UtcNow));

    public Task<HubResult> PlayAgain() => Run("replay", null, (room, pid) =>
    {
        runtime.ClearPositions(room.Id);
        return rooms.Engine.PlayAgain(room, pid, DateTime.UtcNow);
    });

    public Task<HubResult> Leave() => Run("leave", null, (room, pid) => rooms.Engine.Leave(room, pid, DateTime.UtcNow));

    public async Task<HubResult> RegenerateCode()
    {
        if (PlayerId is not { } pid || RoomId is not { } rid) return NotConnected();
        if (!Allow("code", 5, 60)) return TooFast();
        var exec = await rooms.RegenerateCodeAsync(rid, pid);
        await Broadcast(exec);
        return ToResult(exec);
    }

    public Task<HubResult> SubmitAnswer(string puzzleId, JsonElement answer, string clientActionId)
    {
        if (!Allow("answer", 6, 10)) return Task.FromResult(TooFast());
        return Run("answer", clientActionId, (room, pid) => rooms.Engine.SubmitAnswer(room, pid, puzzleId, answer, DateTime.UtcNow),
            new JsonObject { ["puzzleId"] = puzzleId, ["answer"] = JsonNode.Parse(answer.GetRawText()) });
    }

    public Task<HubResult> RequestHint(string puzzleId, string clientActionId)
    {
        if (!Allow("hint", 4, 10)) return Task.FromResult(TooFast());
        return Run("hint", clientActionId, (room, pid) => rooms.Engine.RequestHint(room, pid, puzzleId, DateTime.UtcNow),
            new JsonObject { ["puzzleId"] = puzzleId });
    }

    public Task<HubResult> PickUp(string itemId, string clientActionId) =>
        Run("pickup", clientActionId, (room, pid) => rooms.Engine.PickUp(room, pid, itemId, DateTime.UtcNow), new JsonObject { ["itemId"] = itemId });

    public Task<HubResult> Combine(string a, string b, string clientActionId) =>
        Run("combine", clientActionId, (room, pid) => rooms.Engine.Combine(room, pid, a, b, DateTime.UtcNow), new JsonObject { ["a"] = a, ["b"] = b });

    public Task<HubResult> PlaceItem(string puzzleId, string itemId, string clientActionId) =>
        Run("place", clientActionId, (room, pid) => rooms.Engine.PlaceItem(room, pid, puzzleId, itemId, DateTime.UtcNow),
            new JsonObject { ["puzzleId"] = puzzleId, ["itemId"] = itemId });

    public Task<HubResult> GetTune(string puzzleId) => Read((room, pid) => rooms.Engine.GetTune(room, pid, puzzleId, DateTime.UtcNow));

    public Task<HubResult> GetPersonalClues(string puzzleId) => Read((room, pid) => rooms.Engine.GetPersonalClues(room, pid, puzzleId, DateTime.UtcNow));

    /// <summary>Position updates are transient: relayed to the other players, never persisted.</summary>
    public async Task Move(float x, float y, float z, float ry, string zone)
    {
        if (PlayerId is not { } pid || RoomId is not { } rid) return;
        if (!Allow("move", 40, 2)) return;
        if (!float.IsFinite(x) || !float.IsFinite(y) || !float.IsFinite(z) || !float.IsFinite(ry)) return;
        zone = (zone ?? "").Length > 16 ? zone![..16] : zone ?? "";
        runtime.SetPosition(rid, pid, new RoomRuntime.Position(x, y, z, ry, zone));
        await Clients.OthersInGroup(Group(rid)).SendAsync("moved", pid.ToString(), x, y, z, ry, zone);
    }

    /// <summary>Lets a player point the group at an object ("look here").</summary>
    public async Task Ping(string objectId)
    {
        if (PlayerId is not { } pid || RoomId is not { } rid) return;
        if (!Allow("ping", 3, 5)) return;
        objectId = (objectId ?? "").Length > 40 ? objectId![..40] : objectId ?? "";
        await Clients.Group(Group(rid)).SendAsync("pinged", pid.ToString(), objectId);
    }

    public async Task<HubResult> SendChat(string? text, string? emote)
    {
        if (PlayerId is not { } pid || RoomId is not { } rid) return NotConnected();
        if (!Allow("chat", 5, 8)) return new HubResult(false, "too-fast", "רגע, רגע... שלחתם הרבה הודעות ברצף.");
        string? cleanText = null, cleanEmote = null;
        if (!string.IsNullOrEmpty(emote))
        {
            if (!ContentFilter.Emotes.TryGetValue(emote, out cleanEmote)) return new HubResult(false, "bad-emote", "האמוטיקון אינו זמין.");
        }
        else
        {
            var t = (text ?? "").Trim();
            var problem = ContentFilter.Check(t);
            if (problem != null) return new HubResult(false, "filtered", problem);
            cleanText = t;
        }
        var nickname = await db.Players.AsNoTracking().Where(p => p.Id == pid).Select(p => p.Nickname).FirstOrDefaultAsync() ?? "";
        var msg = new RoomRuntime.ChatMessage(Guid.NewGuid().ToString("N")[..12], pid, nickname, cleanText, cleanEmote, DateTime.UtcNow);
        runtime.AddChat(rid, msg);
        await Clients.Group(Group(rid)).SendAsync("chat", msg);
        return new HubResult(true, "ok", "");
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        runtime.Forget(Context.ConnectionId);
        if (PlayerId is { } pid && RoomId is { } rid)
        {
            try
            {
                var exec = await rooms.ExecuteAsync(rid, pid, "disconnect", null, null, room =>
                {
                    var p = GameEngine.FindPlayer(room, pid);
                    if (p == null || p.ConnectionId != Context.ConnectionId) return new ActionOutcome(true, "noop", "", [], false);
                    p.IsConnected = false;
                    p.ConnectionId = null;
                    p.LastSeenAt = DateTime.UtcNow;
                    return new ActionOutcome(true, "ok", "", [new GameNotice("player-disconnected", $"{p.Nickname} התנתק — ממתינים שיחזור", p.Id.ToString())], true);
                });
                if (exec.Outcome.StateChanged) await Broadcast(exec);
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Failed to mark player {Player} disconnected", pid);
            }
        }
        await base.OnDisconnectedAsync(exception);
    }

    // ------------------------------------------------------------------ helpers

    private async Task<HubResult> Run(string type, string? clientActionId, Func<GameRoom, Guid, ActionOutcome> action, JsonNode? payload = null)
    {
        if (PlayerId is not { } pid || RoomId is not { } rid) return NotConnected();
        if (!Allow("action", 20, 5)) return TooFast();
        try
        {
            var exec = await rooms.ExecuteAsync(rid, pid, type, clientActionId, payload, room => action(room, pid));
            if (!exec.Duplicate) await Broadcast(exec);
            return ToResult(exec);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Hub action {Type} failed for room {Room}", type, rid);
            return new HubResult(false, "server-error", "אירעה תקלה בשרת. נסו שוב בעוד רגע.");
        }
    }

    private async Task<HubResult> Read(Func<GameRoom, Guid, ActionOutcome> action)
    {
        if (PlayerId is not { } pid || RoomId is not { } rid) return NotConnected();
        if (!Allow("read", 20, 10)) return TooFast();
        var room = await db.Rooms.AsNoTracking().Include(r => r.Players).Include(r => r.Puzzles).AsSplitQuery().FirstOrDefaultAsync(r => r.Id == rid);
        if (room == null) return new HubResult(false, "no-room", "החדר לא נמצא.");
        var outcome = action(room, pid);
        return new HubResult(outcome.Ok, outcome.Code, outcome.Message, outcome.Data);
    }

    private async Task Broadcast(ExecResult exec, bool exceptCaller = false)
    {
        if (exec.Snapshot == null) return;
        if (exec.Outcome.StateChanged || exec.Outcome.Notices.Count > 0)
        {
            var target = exceptCaller ? Clients.OthersInGroup(Group(exec.RoomId)) : Clients.Group(Group(exec.RoomId));
            await target.SendAsync("state", exec.Snapshot);
        }
        foreach (var n in exec.Outcome.Notices)
            await Clients.Group(Group(exec.RoomId)).SendAsync("notice", n);
    }

    private static HubResult ToResult(ExecResult exec) =>
        new(exec.Outcome.Ok, exec.Duplicate ? "duplicate" : exec.Outcome.Code, exec.Outcome.Message, exec.Outcome.Data, exec.Snapshot);

    private bool Allow(string category, int max, int seconds) =>
        runtime.Allow(Context.ConnectionId + ":" + category, max, TimeSpan.FromSeconds(seconds));

    private static HubResult NotConnected() => new(false, "not-connected", "החיבור לחדר אבד. מתחברים מחדש...");
    private static HubResult TooFast() => new(false, "too-fast", "יותר מדי פעולות ברצף — המתינו רגע.");
}
