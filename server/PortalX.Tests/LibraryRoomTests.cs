using System.Text.Json;
using Microsoft.AspNetCore.SignalR.Client;
using PortalX.Server.Content;
using PortalX.Server.Domain;
using PortalX.Server.Game;
using static PortalX.Tests.GameEngineTests;

namespace PortalX.Tests;

/// <summary>The library's evidence chain before the original riddle: four objects, the guards' board, the glowing book.</summary>
public static class LibraryChain
{
    public static readonly string[] Objects = ["book", "hourglass", "lamp", "scroll"];
    public static readonly (string Slot, string Item)[] Board = [("p1", "ev-book"), ("p2", "ev-scroll"), ("p3", "ev-lamp"), ("p4", "ev-hourglass")];

    /// <summary>Plays the chain with one player so the original riddle ("פך השמן") is open.</summary>
    public static void Open(GameEngine e, GameRoom r, Guid player, DateTime t)
    {
        foreach (var o in Objects)
        {
            Assert.True(e.Operate(r, player, "h1-evidence", J(new { op = "inspect", target = o }), t).Ok);
            Assert.True(e.Operate(r, player, "h1-evidence", J(new { op = "reveal", target = o }), t).Ok);
        }
        foreach (var (slot, item) in Board) Assert.True(e.Operate(r, player, "h1-board", J(new { op = "place", slot, item }), t).Ok);
        Assert.Equal("solved", e.Operate(r, player, "h1-book", J(new { op = "inspect", target = "glow-book" }), t).Code);
    }

    public static async Task OpenAsync(HubConnection c)
    {
        async Task Op(string puzzle, object action)
        {
            // the hub allows a burst of mechanism actions per connection; a test that plays faster than a person waits a moment
            for (var attempt = 0; ; attempt++)
            {
                var r = await c.InvokeAsync<JsonElement>("Operate", puzzle, JsonSerializer.SerializeToElement(action), Guid.NewGuid().ToString("N"));
                if (r.GetProperty("code").GetString() == "too-fast" && attempt < 20) { await Task.Delay(300); continue; }
                Assert.True(r.GetProperty("ok").GetBoolean(), r.GetProperty("message").GetString());
                return;
            }
        }
        foreach (var o in Objects)
        {
            await Op("h1-evidence", new { op = "inspect", target = o });
            await Op("h1-evidence", new { op = "reveal", target = o });
        }
        foreach (var (slot, item) in Board) await Op("h1-board", new { op = "place", slot, item });
        await Op("h1-book", new { op = "inspect", target = "glow-book" });
    }

    /// <summary>Points one player earns playing the whole chain: 4 × object, 4 × symbol, the board (placements give none).</summary>
    public const int Points = 4 * 10 + 4 * 15 + 10;
}

public class LibraryRoomTests
{
    private static readonly DateTime T0 = new(2026, 12, 14, 18, 0, 0, DateTimeKind.Utc);
    private static ScenarioContent Content => Catalog.Get("hanukkah-oil");

    private static (GameEngine e, GameRoom r, List<PlayerSession> ps) Start(int players)
    {
        var e = new GameEngine(Catalog, new GameOptions());
        var r = e.CreateRoom("hanukkah-oil", "LIB234", "hash", T0);
        var ps = new List<PlayerSession>();
        for (var i = 0; i < players; i++)
        {
            Assert.True(e.AddPlayer(r, "שחקן" + i, GameEngine.Characters[i % 4], "{}", "t" + i, i == 0, T0, out var p).Ok);
            p!.IsConnected = true;
            ps.Add(p);
        }
        foreach (var p in ps.Skip(1)) e.SetReady(r, p.Id, true);
        Assert.True(e.StartGame(r, ps[0].Id, T0).Ok);
        Assert.True(e.FinishIntro(r, ps[0].Id, true, T0).Ok);
        return (e, r, ps);
    }

    private static ActionOutcome Op(GameEngine e, GameRoom r, PlayerSession p, string puzzle, object action) => e.Operate(r, p.Id, puzzle, J(action), T0);
    private static PuzzleStatus Status(GameRoom r, string id) => r.Puzzles.First(p => p.PuzzleId == id).Status;
    private static WorldState W(GameRoom r) => GameEngine.World(r);
    private static int Personal(GameRoom r, PlayerSession p) => W(r).Score!.Personal.GetValueOrDefault(p.Id.ToString());

    [Fact]
    public void The_chain_opens_step_by_step_and_the_original_riddle_still_gives_the_key()
    {
        var (e, r, ps) = Start(1);
        var p = ps[0];
        Assert.Equal(PuzzleStatus.Active, Status(r, "h1-evidence"));
        foreach (var id in new[] { "h1-board", "h1-book", "h1-riddle" }) Assert.Equal(PuzzleStatus.Locked, Status(r, id));
        Assert.Equal("locked", e.SubmitAnswer(r, p.Id, "h1-riddle", J("פך השמן"), T0).Code);

        // a symbol shows only after the object was examined
        Assert.Equal("not-inspected", Op(e, r, p, "h1-evidence", new { op = "reveal", target = "book" }).Code);
        Assert.Equal("bad-target", Op(e, r, p, "h1-evidence", new { op = "inspect", target = "globe" }).Code);
        foreach (var o in LibraryChain.Objects)
        {
            Assert.True(Op(e, r, p, "h1-evidence", new { op = "inspect", target = o }).Ok);
            Assert.True(Op(e, r, p, "h1-evidence", new { op = "reveal", target = o }).Ok);
        }
        Assert.Equal(PuzzleStatus.Solved, Status(r, "h1-evidence"));
        foreach (var it in new[] { "ev-book", "ev-hourglass", "ev-lamp", "ev-scroll" }) Assert.Contains(it, W(r).Inventory);
        Assert.Equal(PuzzleStatus.Active, Status(r, "h1-board"));
        Assert.Equal(PuzzleStatus.Locked, Status(r, "h1-book"));

        // a full board in the wrong order is refused; the symbols can be taken back and placed again
        Assert.True(Op(e, r, p, "h1-board", new { op = "place", slot = "p1", item = "ev-scroll" }).Ok);
        Assert.True(Op(e, r, p, "h1-board", new { op = "place", slot = "p2", item = "ev-book" }).Ok);
        Assert.True(Op(e, r, p, "h1-board", new { op = "place", slot = "p3", item = "ev-lamp" }).Ok);
        Assert.Equal("placed-wrong", Op(e, r, p, "h1-board", new { op = "place", slot = "p4", item = "ev-hourglass" }).Code);
        Assert.Equal(PuzzleStatus.Active, Status(r, "h1-board"));
        Assert.True(Op(e, r, p, "h1-board", new { op = "remove", slot = "p1" }).Ok);
        Assert.True(Op(e, r, p, "h1-board", new { op = "remove", slot = "p2" }).Ok);
        Assert.True(Op(e, r, p, "h1-board", new { op = "place", slot = "p1", item = "ev-book" }).Ok);
        Assert.Equal("solved", Op(e, r, p, "h1-board", new { op = "place", slot = "p2", item = "ev-scroll" }).Code);
        Assert.Equal(PuzzleStatus.Active, Status(r, "h1-book"));
        Assert.Equal(PuzzleStatus.Locked, Status(r, "h1-riddle"));

        Assert.Equal("solved", Op(e, r, p, "h1-book", new { op = "inspect", target = "glow-book" }).Code);
        Assert.Equal(PuzzleStatus.Active, Status(r, "h1-riddle"));
        Assert.DoesNotContain("workshop", e.UnlockedZones(r, Content));
        Assert.DoesNotContain("antique-key", W(r).Inventory);

        Assert.Equal("wrong", e.SubmitAnswer(r, p.Id, "h1-riddle", J("מנורת שמן"), T0).Code);
        Assert.Equal("solved", e.SubmitAnswer(r, p.Id, "h1-riddle", J("פך השמן"), T0).Code);
        Assert.Contains("antique-key", W(r).Inventory);
        Assert.Contains("workshop", e.UnlockedZones(r, Content));
    }

    [Fact]
    public void Every_step_scores_once_on_the_server()
    {
        var (e, r, ps) = Start(4);
        // object 10 to whoever examined it first, symbol 15 to whoever uncovered it; sending again changes nothing
        Assert.True(Op(e, r, ps[0], "h1-evidence", new { op = "inspect", target = "book" }).Ok);
        Assert.Equal("known", Op(e, r, ps[1], "h1-evidence", new { op = "inspect", target = "book" }).Code);
        Assert.True(Op(e, r, ps[1], "h1-evidence", new { op = "reveal", target = "book" }).Ok);
        Assert.Equal("known", Op(e, r, ps[1], "h1-evidence", new { op = "reveal", target = "book" }).Code);
        Assert.Equal("known", Op(e, r, ps[2], "h1-evidence", new { op = "reveal", target = "book" }).Code);
        Assert.Equal(10, Personal(r, ps[0]));
        Assert.Equal(15, Personal(r, ps[1]));
        Assert.Equal(0, Personal(r, ps[2]));
        Assert.Single(W(r).Inventory, i => i == "ev-book");

        foreach (var o in new[] { "hourglass", "lamp", "scroll" })
        {
            Assert.True(Op(e, r, ps[2], "h1-evidence", new { op = "inspect", target = o }).Ok);
            Assert.True(Op(e, r, ps[3], "h1-evidence", new { op = "reveal", target = o }).Ok);
        }
        Assert.Equal(30, Personal(r, ps[2]));
        Assert.Equal(45, Personal(r, ps[3]));   // solving the inspection itself gives nothing extra

        // the board: 10 to the player who completed it, no points per placement
        foreach (var (slot, item) in LibraryChain.Board.Take(3)) Assert.True(Op(e, r, ps[0], "h1-board", new { op = "place", slot, item }).Ok);
        Assert.Equal(10, Personal(r, ps[0]));
        Assert.Equal("solved", Op(e, r, ps[1], "h1-board", new { op = "place", slot = "p4", item = "ev-hourglass" }).Code);
        Assert.Equal(25, Personal(r, ps[1]));
        Assert.Equal(10, Personal(r, ps[0]));

        Assert.Equal("solved", Op(e, r, ps[2], "h1-book", new { op = "inspect", target = "glow-book" }).Code);
        Assert.Equal(30, Personal(r, ps[2]));
        Assert.Equal("already-solved", Op(e, r, ps[3], "h1-book", new { op = "inspect", target = "glow-book" }).Code);
        Assert.Equal(W(r).Score!.Log.Count, W(r).Score!.Log.Select(x => x.Key).Distinct().Count());
        // the room's group points come when the whole room is done; the group already has the no-hint bonus of its three steps
        Assert.Equal(3 * 10, W(r).Score!.Group);
    }

    [Fact]
    public void The_guards_inscriptions_allow_exactly_one_arrangement_and_it_is_the_configured_one()
    {
        string[] items = ["ev-book", "ev-hourglass", "ev-lamp", "ev-scroll"];
        IEnumerable<string[]> Perms(string[] a) => a.Length <= 1 ? [a] : a.SelectMany((x, i) => Perms(a.Where((_, k) => k != i).ToArray()).Select(p => new[] { x }.Concat(p).ToArray()));
        bool Fits(string[] p)
        {
            int At(string it) => Array.IndexOf(p, it) + 1;   // places 1–4 from left to right; 1 is the darkest
            return At("ev-lamp") != 1                         // the light is not in the darkest place
                && Math.Abs(At("ev-book") - At("ev-hourglass")) != 1   // the book is not next to the hourglass
                && At("ev-lamp") == At("ev-scroll") + 1       // the lamp is right of the scroll
                && At("ev-scroll") != 1                        // the scroll is not first
                && At("ev-hourglass") == 4;                    // the hourglass is last
        }
        var fits = Perms(items).Where(Fits).ToList();
        var only = Assert.Single(fits);
        var solution = Content.Puzzle("h1-board").Solution["slots"]!.AsObject();
        Assert.Equal(only, new[] { "p1", "p2", "p3", "p4" }.Select(s => solution[s]!.GetValue<string>()).ToArray());
        Assert.Equal(["ev-book", "ev-scroll", "ev-lamp", "ev-hourglass"], only);
        Assert.Equal(5, Content.Puzzle("h1-board").PublicData["inscriptions"]!.AsArray().Count);
    }

    [Fact]
    public void A_single_player_and_four_players_both_reach_the_workshop()
    {
        foreach (var n in new[] { 1, 4 })
        {
            var (e, r, ps) = Start(n);
            LibraryChain.Open(e, r, ps[n - 1].Id, T0);
            Assert.Equal("solved", e.SubmitAnswer(r, ps[0].Id, "h1-riddle", J("פך השמן"), T0).Code);
            Assert.Equal("workshop", W(r).PendingZone);
            Assert.True(e.Continue(r, ps[0].Id, T0).Ok);
            Assert.Equal("workshop", e.CurrentZone(r).Zone);
        }
    }

    // ------------------------------------------------------------------ games saved before the chain existed

    /// <summary>Turns a fresh game into one saved before the chain: no state for the new puzzles, the riddle open.</summary>
    private static (GameEngine e, GameRoom r, List<PlayerSession> ps) OldGame()
    {
        var (e, r, ps) = Start(2);
        r.Puzzles.RemoveAll(p => p.PuzzleId is "h1-evidence" or "h1-board" or "h1-book");
        r.Puzzles.First(p => p.PuzzleId == "h1-riddle").Status = PuzzleStatus.Active;
        W(r).Mechanisms.Remove("h1-evidence");
        W(r).Mechanisms.Remove("h1-book");
        W(r).Mechanisms.Remove("h1-board");
        r.WorldJson = JsonSerializer.Serialize(W(r), ScenarioCatalog.JsonOptions);
        return (e, r, ps);
    }

    [Fact]
    public void An_old_game_in_the_library_keeps_its_open_riddle_and_nothing_else_changes()
    {
        var (e, r, ps) = OldGame();
        Assert.True(e.DiscoverClue(r, ps[0].Id, "r1-letter", T0).Ok);
        var before = r.WorldJson;
        e.FillMissingPuzzles(r);
        foreach (var id in new[] { "h1-evidence", "h1-board", "h1-book" }) Assert.Equal(PuzzleStatus.Solved, Status(r, id));
        Assert.Equal(PuzzleStatus.Active, Status(r, "h1-riddle"));
        Assert.Equal(before, r.WorldJson);   // bag, score, rooms and mechanisms untouched
        Assert.DoesNotContain("workshop", e.UnlockedZones(r, Content));
        Assert.Equal(10, Personal(r, ps[0]));

        // filling twice adds nothing, and the riddle opens the drawer exactly as before
        e.FillMissingPuzzles(r);
        Assert.Equal(Content.Puzzles.Count, r.Puzzles.Count);
        Assert.Equal("solved", e.SubmitAnswer(r, ps[1].Id, "h1-riddle", J("פך השמן"), T0).Code);
        Assert.Contains("antique-key", W(r).Inventory);
        Assert.Equal(25, Personal(r, ps[1]));
        Assert.Equal(100 + 10, W(r).Score!.Rooms["library"]);   // the room, and the riddle solved without a hint
        Assert.DoesNotContain(W(r).Score!.Log, x => x.PuzzleId is "h1-evidence" or "h1-board" or "h1-book");
    }

    [Fact]
    public void An_old_game_past_the_library_or_finished_stays_exactly_as_it_was()
    {
        // a game that is already in the workshop, then saved as an old one would be (no state for the chain)
        var (e, r, ps) = Start(2);
        LibraryChain.Open(e, r, ps[1].Id, T0);
        Assert.Equal("solved", e.SubmitAnswer(r, ps[0].Id, "h1-riddle", J("פך השמן"), T0).Code);
        Assert.True(e.Continue(r, ps[0].Id, T0).Ok);
        r.Puzzles.RemoveAll(p => p.PuzzleId is "h1-evidence" or "h1-board" or "h1-book");
        var world = r.WorldJson;
        var zones = e.UnlockedZones(r, Content).OrderBy(z => z).ToList();
        e.FillMissingPuzzles(r);
        foreach (var id in new[] { "h1-evidence", "h1-board", "h1-book" }) Assert.Equal(PuzzleStatus.Solved, Status(r, id));
        Assert.Equal(world, r.WorldJson);
        Assert.Equal(zones, e.UnlockedZones(r, Content).OrderBy(z => z).ToList());
        Assert.Equal(PuzzleStatus.Active, Status(r, "h2-wicks"));

        var (e2, r2, _) = OldGame();
        r2.Phase = RoomPhase.Completed;
        e2.FillMissingPuzzles(r2);
        foreach (var id in new[] { "h1-evidence", "h1-board", "h1-book" }) Assert.Equal(PuzzleStatus.Solved, Status(r2, id));

        // a game still in the lobby is left alone: starting it sets every puzzle
        var e3 = new GameEngine(Catalog, new GameOptions());
        var r3 = e3.CreateRoom("hanukkah-oil", "LOB234", "hash", T0);
        var count = r3.Puzzles.Count;
        e3.FillMissingPuzzles(r3);
        Assert.Equal(count, r3.Puzzles.Count);
    }
}
