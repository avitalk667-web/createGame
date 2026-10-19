using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using PortalX.Server.Data;
using PortalX.Server.Domain;

namespace PortalX.Server.Game;

public sealed record ExecResult(ActionOutcome Outcome, RoomSnapshot? Snapshot, bool Duplicate, Guid RoomId);

/// <summary>
/// Runs every state-changing action under a per-room lock, persists it, logs a GameEvent and
/// de-duplicates repeated client actions (spec §13: no double solves / double events).
/// </summary>
public sealed class RoomService(PortalDbContext db, GameEngine engine, ILogger<RoomService> logger)
{
    private static readonly ConcurrentDictionary<Guid, SemaphoreSlim> Locks = new();
    private const string CodeAlphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    public const int CodeLength = 6;

    public GameEngine Engine => engine;

    public static string NewToken() => Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    public static string Hash(string token) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token)));

    public static string NewCode() => new(Enumerable.Range(0, CodeLength).Select(_ => CodeAlphabet[RandomNumberGenerator.GetInt32(CodeAlphabet.Length)]).ToArray());

    public static string NormalizeCode(string code) => (code ?? "").Trim().ToUpperInvariant().Replace("-", "").Replace(" ", "");

    public async Task<(GameRoom room, string hostClaim)> CreateRoomAsync(string scenarioId)
    {
        var hostClaim = NewToken();
        string code;
        do { code = NewCode(); } while (await db.Rooms.AnyAsync(r => r.Code == code));
        var room = engine.CreateRoom(scenarioId, code, Hash(hostClaim), DateTime.UtcNow);
        db.Rooms.Add(room);
        db.Events.Add(new GameEvent { RoomId = room.Id, Type = "room-created", CreatedAt = DateTime.UtcNow });
        await db.SaveChangesAsync();
        logger.LogInformation("Room {Code} created for scenario {Scenario}", code, scenarioId);
        return (room, hostClaim);
    }

    public Task<GameRoom?> FindByCodeAsync(string code) =>
        db.Rooms.AsNoTracking().Include(r => r.Players).FirstOrDefaultAsync(r => r.Code == NormalizeCode(code));

    public Task<PlayerSession?> FindPlayerByTokenAsync(string token) =>
        db.Players.AsNoTracking().FirstOrDefaultAsync(p => p.TokenHash == Hash(token) && !p.IsRemoved);

    public async Task<RoomSnapshot?> SnapshotAsync(Guid roomId)
    {
        var room = await LoadAsync(roomId, tracking: false);
        return room == null ? null : Snapshots.Build(engine, room, await LatestResultAsync(room), DateTime.UtcNow);
    }

    /// <summary>Executes an action against the room with locking, persistence, event logging and de-duplication.</summary>
    public async Task<ExecResult> ExecuteAsync(Guid roomId, Guid? playerId, string type, string? clientActionId,
        JsonNode? payload, Func<GameRoom, ActionOutcome> action)
    {
        if (clientActionId is { Length: > 64 }) clientActionId = clientActionId[..64];
        var gate = Locks.GetOrAdd(roomId, _ => new SemaphoreSlim(1, 1));
        await gate.WaitAsync();
        try
        {
            if (clientActionId != null)
            {
                var prior = await db.Events.AsNoTracking().FirstOrDefaultAsync(e => e.RoomId == roomId && e.ClientActionId == clientActionId);
                if (prior != null)
                {
                    var stored = JsonSerializer.Deserialize<StoredOutcome>(prior.ResultJson, Content.ScenarioCatalog.JsonOptions);
                    var dup = stored == null
                        ? ActionOutcome.Fail("duplicate", "הפעולה כבר בוצעה.")
                        : new ActionOutcome(stored.Ok, stored.Code, stored.Message, Array.Empty<GameNotice>(), false);
                    return new ExecResult(dup, await SnapshotAsync(roomId), true, roomId);
                }
            }

            var room = await LoadAsync(roomId, tracking: true);
            if (room == null) return new ExecResult(ActionOutcome.Fail("no-room", "החדר לא נמצא."), null, false, roomId);
            var wasCompleted = room.Phase == RoomPhase.Completed;
            var outcome = action(room);
            var now = DateTime.UtcNow;

            if (outcome.StateChanged || clientActionId != null)
            {
                db.Events.Add(new GameEvent
                {
                    RoomId = roomId,
                    PlayerId = playerId,
                    Type = type,
                    ClientActionId = clientActionId,
                    PayloadJson = payload?.ToJsonString() ?? "{}",
                    ResultJson = JsonSerializer.Serialize(new StoredOutcome(outcome.Ok, outcome.Code, outcome.Message), Content.ScenarioCatalog.JsonOptions),
                    CreatedAt = now,
                });
            }
            if (!wasCompleted && room.Phase == RoomPhase.Completed)
            {
                var result = engine.BuildResult(room);
                db.Results.Add(result);
                db.Events.Add(new GameEvent { RoomId = roomId, Type = "game-result", PayloadJson = JsonSerializer.Serialize(new { result.DurationSeconds, result.HintsUsed }), CreatedAt = now });
                logger.LogInformation("Room {Code} completed in {Seconds}s", room.Code, result.DurationSeconds);
            }
            await db.SaveChangesAsync();
            var snapshot = Snapshots.Build(engine, room, await LatestResultAsync(room), now);
            return new ExecResult(outcome, snapshot, false, roomId);
        }
        catch (DbUpdateException ex)
        {
            logger.LogWarning(ex, "Concurrent/duplicate action {Type} in room {Room}", type, roomId);
            db.ChangeTracker.Clear();
            return new ExecResult(ActionOutcome.Fail("duplicate", "הפעולה כבר בוצעה."), await SnapshotAsync(roomId), true, roomId);
        }
        finally
        {
            gate.Release();
        }
    }

    public async Task<ExecResult> RegenerateCodeAsync(Guid roomId, Guid playerId)
    {
        string code;
        do { code = NewCode(); } while (await db.Rooms.AnyAsync(r => r.Code == code));
        return await ExecuteAsync(roomId, playerId, "code-regenerated", null, null, room =>
        {
            if (room.HostPlayerId != playerId) return ActionOutcome.Fail("not-host", "רק המארח יכול לבטל את הקישור.");
            if (room.Phase != RoomPhase.Lobby) return ActionOutcome.Fail("game-started", "אי אפשר להחליף קוד באמצע משחק.");
            room.Code = code;
            return ActionOutcome.Done("הקישור הקודם בוטל ונוצר קוד חדש",
                new GameNotice("code-changed", "המארח ביטל את קישור ההזמנה הקודם ויצר קוד חדש."));
        });
    }

    private Task<GameRoom?> LoadAsync(Guid roomId, bool tracking)
    {
        var q = db.Rooms.Include(r => r.Players).Include(r => r.Puzzles).AsSplitQuery();
        return (tracking ? q : q.AsNoTracking()).FirstOrDefaultAsync(r => r.Id == roomId);
    }

    private async Task<GameResult?> LatestResultAsync(GameRoom room)
    {
        if (room.Phase != RoomPhase.Completed) return null;
        var local = db.Results.Local.Where(r => r.RoomId == room.Id && r.Round == room.Round).OrderByDescending(r => r.CreatedAt).FirstOrDefault();
        return local ?? await db.Results.AsNoTracking().Where(r => r.RoomId == room.Id && r.Round == room.Round)
            .OrderByDescending(r => r.CreatedAt).FirstOrDefaultAsync();
    }

    private sealed record StoredOutcome(bool Ok, string Code, string Message);
}

/// <summary>Transient per-room data that does not need to be persisted: positions and recent chat.</summary>
public sealed class RoomRuntime
{
    public sealed record ChatMessage(string Id, Guid PlayerId, string Nickname, string? Text, string? Emote, DateTime At);
    public sealed record Position(float X, float Y, float Z, float Ry, string Zone);

    private readonly ConcurrentDictionary<Guid, List<ChatMessage>> _chat = new();
    private readonly ConcurrentDictionary<Guid, ConcurrentDictionary<Guid, Position>> _positions = new();
    private readonly ConcurrentDictionary<string, (DateTime windowStart, int count)> _rates = new();

    public IReadOnlyList<ChatMessage> Chat(Guid roomId)
    {
        var list = _chat.GetOrAdd(roomId, _ => new());
        lock (list) return list.ToList();
    }

    public void AddChat(Guid roomId, ChatMessage msg)
    {
        var list = _chat.GetOrAdd(roomId, _ => new());
        lock (list)
        {
            list.Add(msg);
            if (list.Count > 40) list.RemoveAt(0);
        }
    }

    public void SetPosition(Guid roomId, Guid playerId, Position pos) => _positions.GetOrAdd(roomId, _ => new())[playerId] = pos;

    public IReadOnlyDictionary<Guid, Position> Positions(Guid roomId) => _positions.GetOrAdd(roomId, _ => new());

    public void ClearPositions(Guid roomId) => _positions.TryRemove(roomId, out _);

    /// <summary>Simple fixed-window limiter per connection and action category (spec §19).</summary>
    public bool Allow(string key, int maxPerWindow, TimeSpan window)
    {
        var now = DateTime.UtcNow;
        var allowed = true;
        _rates.AddOrUpdate(key, _ => (now, 1), (_, cur) =>
        {
            if (now - cur.windowStart > window) return (now, 1);
            if (cur.count >= maxPerWindow) { allowed = false; return cur; }
            return (cur.windowStart, cur.count + 1);
        });
        return allowed;
    }

    public void Forget(string connectionId)
    {
        foreach (var k in _rates.Keys.Where(k => k.StartsWith(connectionId, StringComparison.Ordinal))) _rates.TryRemove(k, out _);
    }
}
