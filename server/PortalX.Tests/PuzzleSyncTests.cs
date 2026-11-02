using PortalX.Server.Content;
using PortalX.Server.Domain;
using PortalX.Server.Game;
using static PortalX.Tests.GameEngineTests;

namespace PortalX.Tests;

/// <summary>
/// Shared puzzles in real time: every accepted change raises the puzzle's version and tells everyone who did what; an
/// action based on an older view (another player changed it in the meantime) is refused instead of overwriting it.
/// </summary>
public class PuzzleSyncTests
{
    private static readonly DateTime T0 = new(2026, 12, 14, 18, 0, 0, DateTimeKind.Utc);

    private static (GameEngine e, GameRoom r, List<PlayerSession> ps) BoardReady()
    {
        var e = new GameEngine(Catalog, new GameOptions());
        var r = e.CreateRoom("hanukkah-oil", "SYN234", "hash", T0);
        var ps = new List<PlayerSession>();
        foreach (var (n, i) in new[] { ("יהודה", 0), ("שמעון", 1) })
        {
            Assert.True(e.AddPlayer(r, n, GameEngine.Characters[i], "{}", "t" + i, i == 0, T0, out var p).Ok);
            p!.IsConnected = true;
            ps.Add(p);
        }
        e.SetReady(r, ps[1].Id, true);
        Assert.True(e.StartGame(r, ps[0].Id, T0).Ok);
        Assert.True(e.FinishIntro(r, ps[0].Id, true, T0).Ok);
        foreach (var o in LibraryChain.Objects)
        {
            e.Operate(r, ps[0].Id, "h1-evidence", J(new { op = "inspect", target = o }), T0);
            e.Operate(r, ps[0].Id, "h1-evidence", J(new { op = "reveal", target = o }), T0);
        }
        return (e, r, ps);
    }

    private static MechanismState Board(GameRoom r) => GameEngine.World(r).Mechanisms["h1-board"];

    [Fact]
    public void A_change_raises_the_version_and_tells_everyone_who_did_what()
    {
        var (e, r, ps) = BoardReady();
        var o = e.Operate(r, ps[0].Id, "h1-board", J(new { op = "place", slot = "p2", item = "ev-scroll" }), T0);
        Assert.True(o.Ok);
        var line = Assert.Single(o.Notices, n => n.Kind == "puzzle-action");
        Assert.StartsWith("יהודה · לוח העדויות: הניח את", line.Message);
        Assert.Contains("„מקום 2”", line.Message);
        Assert.Equal(ps[0].Id.ToString(), line.PlayerId);
        Assert.DoesNotContain(o.Notices, n => n.Kind == "item-placed");   // one line per action
        Assert.Equal(1, Board(r).Rev);
        Assert.Equal("יהודה", Board(r).LastBy);
        Assert.Equal(ps[0].Id.ToString(), Board(r).SlotBy["p2"]);

        var off = e.Operate(r, ps[1].Id, "h1-board", J(new { op = "remove", slot = "p2", rev = 1 }), T0);
        Assert.True(off.Ok);
        Assert.Contains(off.Notices, n => n.Kind == "puzzle-action" && n.Message.StartsWith("שמעון · לוח העדויות: הוריד את") && n.Message.Contains("מ„מקום 2”"));
        Assert.Equal(2, Board(r).Rev);
    }

    [Fact]
    public void An_action_on_an_older_view_is_refused_and_changes_nothing()
    {
        var (e, r, ps) = BoardReady();
        // both see version 0; Yehuda places first
        Assert.True(e.Operate(r, ps[0].Id, "h1-board", J(new { op = "place", slot = "p1", item = "ev-book", rev = 0 }), T0).Ok);
        var json = r.WorldJson;
        // Shimon still acts on version 0: refused, with the name of who changed it, and nothing is saved
        var late = e.Operate(r, ps[1].Id, "h1-board", J(new { op = "remove", slot = "p1", rev = 0 }), T0);
        Assert.False(late.Ok);
        Assert.Equal("changed", late.Code);
        Assert.Contains("יהודה", late.Message);
        Assert.False(late.StateChanged);
        Assert.Equal(json, r.WorldJson);
        // with the version he now sees, it works
        Assert.True(e.Operate(r, ps[1].Id, "h1-board", J(new { op = "remove", slot = "p1", rev = 1 }), T0).Ok);
    }

    [Fact]
    public void A_players_own_quick_actions_never_conflict_and_old_clients_without_a_version_still_work()
    {
        var (e, r, ps) = BoardReady();
        // two quick placements by the same player, both sent while their screen still showed version 0
        Assert.True(e.Operate(r, ps[0].Id, "h1-board", J(new { op = "place", slot = "p1", item = "ev-book", rev = 0 }), T0).Ok);
        Assert.True(e.Operate(r, ps[0].Id, "h1-board", J(new { op = "place", slot = "p2", item = "ev-scroll", rev = 0 }), T0).Ok);
        // a client that sends no version is served as before
        Assert.True(e.Operate(r, ps[1].Id, "h1-board", J(new { op = "place", slot = "p3", item = "ev-lamp" }), T0).Ok);
        Assert.Equal(3, Board(r).Rev);
    }

    [Fact]
    public void A_refused_action_does_not_raise_the_version_and_the_solve_keeps_its_changes()
    {
        var (e, r, ps) = BoardReady();
        Assert.Equal("slot-empty", e.Operate(r, ps[0].Id, "h1-board", J(new { op = "remove", slot = "p1" }), T0).Code);
        Assert.False(GameEngine.World(r).Mechanisms.TryGetValue("h1-board", out var m) && m.Rev > 0);
        foreach (var (slot, item) in LibraryChain.Board) e.Operate(r, ps[0].Id, "h1-board", J(new { op = "place", slot, item }), T0);
        Assert.Equal(PuzzleStatus.Solved, r.Puzzles.First(p => p.PuzzleId == "h1-board").Status);
        // the version write after the solve keeps what the solve saved (its score and the next puzzle)
        Assert.Contains(GameEngine.World(r).Score!.Log, x => x.Key == "mechanism:h1-board");
        Assert.Equal(4, Board(r).Rev);
    }
}
