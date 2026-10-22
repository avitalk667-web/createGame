using PortalX.Server.Domain;
using PortalX.Server.Game;
using static PortalX.Tests.GameEngineTests;

namespace PortalX.Tests;

/// <summary>Spec 13ב–ד: one record per participant, 30-minute seats, joining mid-game, the host role, scoring without doubles.</summary>
public class SeatAndHostTests
{
    private static readonly DateTime T0 = new(2026, 12, 14, 18, 0, 0, DateTimeKind.Utc);
    private static readonly string[] Names = ["ישראל", "דוד", "אורי", "משה", "יונתן", "נתן", "שמואל", "אליהו", "יעקב"];

    private static (GameEngine e, GameRoom r, List<PlayerSession> ps) Room(int players, bool start = true)
    {
        var e = new GameEngine(Catalog, new GameOptions());
        var r = e.CreateRoom("hanukkah-oil", "SEAT23", "hash", T0);
        var ps = new List<PlayerSession>();
        for (var i = 0; i < players; i++) ps.Add(Join(e, r, i, T0));
        if (start)
        {
            foreach (var p in ps.Skip(1)) e.SetReady(r, p.Id, true);
            Assert.True(e.StartGame(r, ps[0].Id, T0).Ok);
            Assert.True(e.FinishIntro(r, ps[0].Id, true, T0).Ok);
        }
        return (e, r, ps);
    }

    private static PlayerSession Join(GameEngine e, GameRoom r, int i, DateTime at)
    {
        var res = e.AddPlayer(r, Names[i], GameEngine.Characters[i % 4], "{}", "token-" + i, i == 0, at, out var p);
        Assert.True(res.Ok, res.Message);
        Assert.True(e.Reconnect(r, p!.Id, "c" + i, at).Ok);
        return p;
    }

    private static void Drop(GameEngine e, GameRoom r, PlayerSession p, DateTime at) => Assert.True(e.Disconnect(r, p.Id, p.ConnectionId!, at).Ok);

    [Fact]
    public void Closing_the_tab_keeps_the_same_participant_seat_and_score()
    {
        var (e, r, ps) = Room(2);
        Assert.False(e.PickUp(r, ps[1].Id, "lamp-base", T0).Ok); // the workshop is still locked
        Assert.True(e.DiscoverClue(r, ps[1].Id, "r1-letter", T0).Ok);
        Drop(e, r, ps[1], T0.AddMinutes(1));
        Assert.Equal(GameEngine.SeatState.Away, e.Seat(ps[1], T0.AddMinutes(1)));
        Assert.Equal(2, e.SeatsTaken(r, T0.AddMinutes(1)));

        Assert.True(e.Reconnect(r, ps[1].Id, "c-new", T0.AddMinutes(20)).Ok);
        Assert.Equal(2, GameEngine.ActivePlayers(r).Count());             // no new record
        Assert.Equal(GameEngine.SeatState.Connected, e.Seat(ps[1], T0.AddMinutes(20)));
        Assert.Equal(10, GameEngine.World(r).Score!.Personal[ps[1].Id.ToString()]); // score kept
        Assert.Equal(GameEngine.Characters[1], ps[1].CharacterId);              // same character
    }

    [Fact]
    public void A_seat_is_held_30_minutes_then_freed_and_a_ninth_player_is_never_created()
    {
        var (e, r, ps) = Room(8);
        Drop(e, r, ps[5], T0.AddMinutes(1));

        // still reserved: a ninth person cannot join
        Assert.Equal("room-full", e.AddPlayer(r, Names[8], "explorer", "{}", "t9", false, T0.AddMinutes(30), out _).Code);
        // after 30 minutes the seat is free; the newcomer joins in the middle of the game
        var late = e.AddPlayer(r, Names[8], "explorer", "{}", "t9", false, T0.AddMinutes(31.5), out var ninth);
        Assert.True(late.Ok, late.Message);
        Assert.NotNull(ps[5].SeatReleasedAt);                              // marked released, record kept
        Assert.Equal(9, GameEngine.ActivePlayers(r).Count());
        Assert.Equal(8, e.SeatsTaken(r, T0.AddMinutes(31.5)));

        // the original player comes back: all 8 seats are taken, so he must wait (and no 9th seat is created)
        var back = e.Reconnect(r, ps[5].Id, "c-back", T0.AddMinutes(32));
        Assert.Equal("no-seat", back.Code);
        Assert.Equal(8, e.SeatsTaken(r, T0.AddMinutes(32)));

        // someone leaves on purpose; now he returns as the same participant
        Assert.True(e.Leave(r, ps[2].Id, T0.AddMinutes(33)).Ok);
        Assert.True(e.Reconnect(r, ps[5].Id, "c-back", T0.AddMinutes(34)).Ok);
        Assert.Null(ps[5].SeatReleasedAt);
        Assert.Equal(8, e.SeatsTaken(r, T0.AddMinutes(34)));
        Assert.Equal(9, GameEngine.ActivePlayers(r).Count());              // records are never duplicated or deleted
    }

    [Fact]
    public void Joining_is_open_until_the_game_is_finished()
    {
        var (e, r, ps) = Room(2);
        Assert.True(e.AddPlayer(r, Names[2], "scholar", "{}", "t3", false, T0, out _).Ok); // mid-game
        r.Phase = RoomPhase.Completed;
        Assert.Equal("game-ended", e.AddPlayer(r, Names[3], "scholar", "{}", "t4", false, T0, out _).Code);
    }

    [Fact]
    public void Explicit_leave_frees_the_seat_but_keeps_the_record_and_score()
    {
        var (e, r, ps) = Room(2);
        Assert.True(e.DiscoverClue(r, ps[1].Id, "r1-letter", T0).Ok);
        Assert.True(e.Leave(r, ps[1].Id, T0.AddMinutes(1)).Ok);
        Assert.Equal(GameEngine.SeatState.Released, e.Seat(ps[1], T0.AddMinutes(1)));
        Assert.False(ps[1].IsRemoved);
        Assert.Equal(10, GameEngine.World(r).Score!.Personal[ps[1].Id.ToString()]);
        Assert.Equal(1, e.SeatsTaken(r, T0.AddMinutes(1)));
    }

    [Fact]
    public void Host_away_before_start_another_takes_over_and_there_is_one_host()
    {
        var (e, r, ps) = Room(3, start: false);
        Assert.Equal("host-connected", e.ClaimHost(r, ps[1].Id, T0).Code);   // cannot take it while the host is here
        Drop(e, r, ps[0], T0.AddMinutes(1));
        Assert.True(e.ClaimHost(r, ps[1].Id, T0.AddMinutes(2)).Ok);
        Assert.Equal(ps[1].Id, r.HostPlayerId);
        Assert.Equal("host-connected", e.ClaimHost(r, ps[2].Id, T0.AddMinutes(2)).Code); // no second host
        // the original host returns as himself, as a regular participant; the role is not taken back automatically
        Assert.True(e.Reconnect(r, ps[0].Id, "c-back", T0.AddMinutes(3)).Ok);
        Assert.Equal(ps[1].Id, r.HostPlayerId);
        Assert.Equal(3, GameEngine.ActivePlayers(r).Count());
        // the replacement host can start the game, and hand the role back on purpose
        e.SetReady(r, ps[0].Id, true);
        e.SetReady(r, ps[2].Id, true);
        Assert.True(e.StartGame(r, ps[1].Id, T0.AddMinutes(4)).Ok);
        Assert.True(e.TransferHost(r, ps[1].Id, ps[0].Id, T0.AddMinutes(5)).Ok);
        Assert.Equal(ps[0].Id, r.HostPlayerId);
        Assert.Equal("not-host", e.TransferHost(r, ps[1].Id, ps[2].Id, T0.AddMinutes(5)).Code);
    }

    [Fact]
    public void Only_the_host_frees_the_seat_of_someone_away()
    {
        var (e, r, ps) = Room(3);
        Assert.Equal("connected", e.ReleaseSeatOf(r, ps[0].Id, ps[1].Id, T0).Code);
        Drop(e, r, ps[1], T0);
        Assert.Equal("not-host", e.ReleaseSeatOf(r, ps[2].Id, ps[1].Id, T0).Code);
        Assert.True(e.ReleaseSeatOf(r, ps[0].Id, ps[1].Id, T0).Ok);
        Assert.Equal(GameEngine.SeatState.Released, e.Seat(ps[1], T0));
        Assert.False(ps[1].IsRemoved);
    }

    [Fact]
    public void Continue_waits_for_the_host_unless_he_is_away_or_after_a_while()
    {
        var (e, r, ps) = Room(2);
        Assert.Equal("solved", e.SubmitAnswer(r, ps[1].Id, "h1-riddle", J("פך השמן"), T0).Code);
        Assert.Equal("workshop", GameEngine.World(r).PendingZone);
        Assert.Equal("library", e.CurrentZone(r).Zone);
        Assert.Equal("not-host", e.Continue(r, ps[1].Id, T0.AddSeconds(10)).Code);
        Assert.True(e.Continue(r, ps[1].Id, T0.AddSeconds(95)).Ok);        // after the fallback time anyone may continue
        Assert.Equal("workshop", e.CurrentZone(r).Zone);

        // a later room: the host is away, so the others continue at once
        var (e2, r2, q) = Room(2);
        Assert.Equal("solved", e2.SubmitAnswer(r2, q[1].Id, "h1-riddle", J("פך השמן"), T0).Code);
        Drop(e2, r2, q[0], T0);
        Assert.True(e2.Continue(r2, q[1].Id, T0.AddSeconds(1)).Ok);
    }

    [Fact]
    public void Picking_up_scores_once()
    {
        var (e, r, ps) = Room(2);
        Assert.Equal("solved", e.SubmitAnswer(r, ps[0].Id, "h1-riddle", J("פך השמן"), T0).Code);
        var before = GameEngine.World(r).Score!.Personal.GetValueOrDefault(ps[1].Id.ToString());
        var pick = e.PickUp(r, ps[1].Id, "lamp-base", T0);
        Assert.Contains(pick.Notices, n => n.Message == "דוד אסף את בסיס המנורה וקיבל 10 נקודות");
        Assert.Equal(before + 10, GameEngine.World(r).Score!.Personal[ps[1].Id.ToString()]);
        Assert.Equal("item-missing", e.PickUp(r, ps[1].Id, "lamp-base", T0).Code);
        // placed and taken back again: no second pickup or placement points
        Assert.True(e.Operate(r, ps[1].Id, "h2-lamp", J(new { op = "place", slot = "s1", item = "lamp-base" }), T0).Ok);
        Assert.True(e.Operate(r, ps[1].Id, "h2-lamp", J(new { op = "remove", slot = "s1" }), T0).Ok);
        Assert.True(e.Operate(r, ps[1].Id, "h2-lamp", J(new { op = "place", slot = "s1", item = "lamp-base" }), T0).Ok);
        Assert.Equal(before + 20, GameEngine.World(r).Score!.Personal[ps[1].Id.ToString()]);
        var log = GameEngine.World(r).Score!.Log;
        Assert.Equal(log.Count, log.Select(x => x.Key).Distinct().Count());
    }
}
