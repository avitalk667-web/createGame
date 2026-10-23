using PortalX.Server.Content;
using PortalX.Server.Domain;

namespace PortalX.Server.Game;

/// <summary>
/// Participants, seats, the host role and the group's move between rooms. Four separate things (spec 5):
/// the participant record (never duplicated), the seat it holds, the host role and the connection state.
/// </summary>
public sealed partial class GameEngine
{
    public enum SeatState { Connected, Away, Released }

    /// <summary>
    /// Connected; away (disconnected, seat reserved until <see cref="SeatHeldUntil"/>); or released
    /// (explicit leave, freed by the host, or the reservation expired). Decided from server times only.
    /// </summary>
    public SeatState Seat(PlayerSession p, DateTime now)
    {
        if (p.SeatReleasedAt != null) return SeatState.Released;
        if (p.IsConnected) return SeatState.Connected;
        return now < SeatHeldUntil(p) ? SeatState.Away : SeatState.Released;
    }

    public DateTime SeatHeldUntil(PlayerSession p) => (p.DisconnectedAt ?? p.LastSeenAt).AddMinutes(options.SeatHoldMinutes);

    /// <summary>Seats taken right now: connected players and disconnected ones whose reservation has not expired.</summary>
    public int SeatsTaken(GameRoom room, DateTime now, Guid? except = null) =>
        ActivePlayers(room).Count(p => p.Id != except && Seat(p, now) != SeatState.Released);

    /// <summary>A game accepts players until it is finished (lobby, opening scene and play).</summary>
    public static bool IsOpenForJoining(GameRoom room) => room.Phase != RoomPhase.Completed;

    /// <summary>Marks reservations that have expired as released (bookkeeping; history and score are kept).</summary>
    private void ReleaseExpiredSeats(GameRoom room, DateTime now)
    {
        foreach (var p in ActivePlayers(room))
            if (p.SeatReleasedAt == null && !p.IsConnected && now >= SeatHeldUntil(p))
                p.SeatReleasedAt = now;
    }

    /// <summary>
    /// A known participant comes back (refresh, closed tab, new connection). Never creates a record.
    /// A released seat is taken again only if one is free; the score, character and host role are kept.
    /// </summary>
    public ActionOutcome Reconnect(GameRoom room, Guid playerId, string connectionId, DateTime now)
    {
        var p = FindPlayer(room, playerId);
        if (p == null) return ActionOutcome.Fail("not-in-room", "השחקן הוסר מהחדר.");
        var state = Seat(p, now);
        if (state == SeatState.Released)
        {
            if (room.Phase == RoomPhase.Completed && p.SeatReleasedAt != null)
                return ActionOutcome.Fail("game-ended", "המשחק הזה כבר הסתיים.");
            var max = MaxPlayers(room);
            if (SeatsTaken(room, now, except: p.Id) >= max)
                return ActionOutcome.Fail("no-seat", $"המקום שלך כבר אינו פנוי כרגע — כל {max} המקומות תפוסים. אפשר לנסות שוב כשיתפנה מקום.");
            p.SeatReleasedAt = null;
        }
        var wasConnected = p.IsConnected;
        p.IsConnected = true;
        p.ConnectionId = connectionId;
        p.DisconnectedAt = null;
        p.LastSeenAt = now;
        room.UpdatedAt = now;
        return new ActionOutcome(true, "ok", "", wasConnected ? [] :
            [new GameNotice("player-connected", state == SeatState.Released ? $"{p.Nickname} חזר למשחק" : $"{p.Nickname} התחבר", p.Id.ToString())], true);
    }

    /// <summary>A lost connection: the seat is reserved, nothing is deleted (closing a tab is not leaving).</summary>
    public ActionOutcome Disconnect(GameRoom room, Guid playerId, string connectionId, DateTime now)
    {
        var p = FindPlayer(room, playerId);
        if (p == null || p.ConnectionId != connectionId) return new ActionOutcome(true, "noop", "", [], false);
        p.IsConnected = false;
        p.ConnectionId = null;
        p.DisconnectedAt = now;
        p.LastSeenAt = now;
        room.UpdatedAt = now;
        var who = p.Id == room.HostPlayerId ? "המארח " : "";
        return new ActionOutcome(true, "ok", "",
            [new GameNotice("player-disconnected", $"{who}{p.Nickname} התנתק — המקום שלו שמור {options.SeatHoldMinutes} דקות", p.Id.ToString())], true);
    }

    /// <summary>
    /// Leaving on purpose. In the lobby the player is removed; during the game the seat is released
    /// (the record and score stay). The host role passes to a connected player so the game is never without one.
    /// </summary>
    public ActionOutcome Leave(GameRoom room, Guid playerId, DateTime now)
    {
        var p = FindPlayer(room, playerId);
        if (p == null) return NotInRoom();
        p.IsConnected = false;
        p.ConnectionId = null;
        p.IsReady = false;
        if (room.Phase == RoomPhase.Lobby) p.IsRemoved = true;
        else p.SeatReleasedAt = now;
        var notices = new List<GameNotice> { new("player-left", $"{p.Nickname} עזב את המשחק", p.Id.ToString()) };
        if (room.HostPlayerId == p.Id)
        {
            var next = ActivePlayers(room).Where(x => x.IsConnected && x.Id != p.Id).OrderBy(x => x.Seat).FirstOrDefault();
            room.HostPlayerId = next?.Id;
            if (next != null) notices.Add(new("host-changed", $"{next.Nickname} הוא המארח עכשיו", next.Id.ToString()));
        }
        room.UpdatedAt = now;
        return new ActionOutcome(true, "ok", room.Phase == RoomPhase.Lobby ? "יצאת מהחדר" : "עזבת את המשחק והמקום שלך התפנה", notices, true);
    }

    /// <summary>The host frees the seat of a participant who is not connected (after confirming in the UI).</summary>
    public ActionOutcome ReleaseSeatOf(GameRoom room, Guid hostId, Guid targetId, DateTime now)
    {
        if (FindPlayer(room, hostId) == null) return NotInRoom();
        if (room.HostPlayerId != hostId) return ActionOutcome.Fail("not-host", "רק המארח יכול לפנות מקום.");
        var t = FindPlayer(room, targetId);
        if (t == null) return ActionOutcome.Fail("no-player", "המשתתף לא נמצא.");
        if (t.IsConnected) return ActionOutcome.Fail("connected", "אי אפשר לפנות מקום של משתתף מחובר.");
        if (t.SeatReleasedAt != null) return ActionOutcome.Fail("already-free", "המקום הזה כבר פנוי.");
        t.SeatReleasedAt = now;
        room.UpdatedAt = now;
        return ActionOutcome.Done($"המקום של {t.Nickname} פונה",
            new GameNotice("seat-released", $"המארח פינה את המקום של {t.Nickname}. הניקוד שלו נשמר.", t.Id.ToString()));
    }

    /// <summary>
    /// A connected participant takes the host role when the host is not connected (spec 5).
    /// Runs under the room lock, so two players can never both become host.
    /// </summary>
    public ActionOutcome ClaimHost(GameRoom room, Guid playerId, DateTime now)
    {
        var p = FindPlayer(room, playerId);
        if (p == null) return NotInRoom();
        if (!p.IsConnected) return ActionOutcome.Fail("not-connected", "צריך להיות מחובר כדי להיות המארח.");
        if (room.HostPlayerId == p.Id) return ActionOutcome.Fail("already-host", "את/ה כבר המארח.");
        var host = room.HostPlayerId is { } hid ? FindPlayer(room, hid) : null;
        if (host != null && host.IsConnected) return ActionOutcome.Fail("host-connected", "המארח מחובר. הוא יכול להעביר אליך את התפקיד.");
        room.HostPlayerId = p.Id;
        room.UpdatedAt = now;
        return ActionOutcome.Done($"{p.Nickname} הוא המארח עכשיו", new GameNotice("host-changed", $"{p.Nickname} הוא המארח עכשיו", p.Id.ToString()));
    }

    /// <summary>The host hands the role to another connected participant.</summary>
    public ActionOutcome TransferHost(GameRoom room, Guid hostId, Guid targetId, DateTime now)
    {
        if (FindPlayer(room, hostId) == null) return NotInRoom();
        if (room.HostPlayerId != hostId) return ActionOutcome.Fail("not-host", "רק המארח יכול להעביר את התפקיד.");
        var t = FindPlayer(room, targetId);
        if (t == null || !t.IsConnected || Seat(t, now) == SeatState.Released) return ActionOutcome.Fail("no-player", "אפשר להעביר את התפקיד רק למשתתף מחובר.");
        room.HostPlayerId = t.Id;
        room.UpdatedAt = now;
        return ActionOutcome.Done($"{t.Nickname} הוא המארח עכשיו", new GameNotice("host-changed", $"{t.Nickname} הוא המארח עכשיו", t.Id.ToString()));
    }

    // ---------------------------------------------------------------- moving between rooms

    /// <summary>
    /// When a room opens the group stays where it is, reads the message, and moves on together when the host
    /// presses "Continue" (anyone may, if the host is not connected or after ContinueFallbackSeconds).
    /// </summary>
    public ActionOutcome Continue(GameRoom room, Guid playerId, DateTime now)
    {
        var p = FindPlayer(room, playerId);
        if (p == null) return NotInRoom();
        if (room.Phase != RoomPhase.Playing) return ActionOutcome.Fail("not-playing", "המשחק אינו פעיל כרגע.");
        var world = World(room);
        if (world.PendingZone == null) return new ActionOutcome(true, "noop", "", [], false);
        var host = room.HostPlayerId is { } hid ? FindPlayer(room, hid) : null;
        var hostAway = host == null || !host.IsConnected;
        var waited = now - (world.PendingSince ?? now) >= TimeSpan.FromSeconds(options.ContinueFallbackSeconds);
        if (room.HostPlayerId != p.Id && !hostAway && !waited)
            return ActionOutcome.Fail("not-host", "המארח ימשיך כשכולם יסיימו לקרוא.");
        var scenario = catalog.Get(room.ScenarioId);
        var zone = scenario.Zones.First(z => z.Id == world.PendingZone);
        world.CurrentZone = zone.Id;
        world.CurrentZoneSince = now;
        world.PendingZone = null;
        world.PendingSince = null;
        SaveWorld(room, world, now);
        return ActionOutcome.Done($"עוברים אל {zone.Name}",
            new GameNotice("zone-entered", $"עוברים יחד אל {zone.Name}", p.Id.ToString(), Zone: zone.Id, VoiceLine: zone.EntryLine));
    }

    /// <summary>The room the group is in (older rooms without this field: the furthest unlocked one).</summary>
    public (string Zone, DateTime? Since) CurrentZone(GameRoom room)
    {
        var world = World(room);
        if (world.CurrentZone != null) return (world.CurrentZone, world.CurrentZoneSince);
        var scenario = catalog.Get(room.ScenarioId);
        var unlocked = UnlockedZones(room, scenario);
        return (scenario.Zones.Where(z => unlocked.Contains(z.Id)).OrderBy(z => z.Order).Last().Id, null);
    }
}
