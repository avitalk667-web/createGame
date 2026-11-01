using System.Text.Json;
using PortalX.Server.Content;
using PortalX.Server.Domain;
using PortalX.Server.Game;
using static PortalX.Tests.GameEngineTests;

namespace PortalX.Tests;

/// <summary>The workshop's preparation before the original lamp assembly: the wicks, the light test, the blueprint.</summary>
public static class WorkshopChain
{
    public static readonly (string Slot, string Item)[] Wicks = [("v-small", "w-short"), ("v-medium", "w-medium"), ("v-large", "w-long"), ("v-star", "w-star")];

    /// <summary>Plays the chain with one player so the original assembly is open.</summary>
    public static void Open(GameEngine e, GameRoom r, Guid player, DateTime t)
    {
        foreach (var (slot, item) in Wicks) Assert.True(e.Operate(r, player, "h2-wicks", J(new { op = "place", slot, item }), t).Ok);
        Assert.Equal("solved", e.SubmitAnswer(r, player, "h2-test", J("3"), t).Code);
        Assert.Equal("solved", e.Operate(r, player, "h2-blueprint", J(new { op = "inspect", target = "plate" }), t).Code);
    }

    /// <summary>Points one player earns playing the whole chain: the wicks, the light test and the blueprint.</summary>
    public const int Points = 10 + 10 + 15;
}

public class WorkshopRoomTests
{
    private static readonly DateTime T0 = new(2026, 12, 14, 18, 0, 0, DateTimeKind.Utc);
    private static ScenarioContent Content => Catalog.Get("hanukkah-oil");

    /// <summary>A game whose group has just opened the workshop (the library done by the first player).</summary>
    private static (GameEngine e, GameRoom r, List<PlayerSession> ps) InWorkshop(int players)
    {
        var e = new GameEngine(Catalog, new GameOptions());
        var r = e.CreateRoom("hanukkah-oil", "WRK234", "hash", T0);
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
        LibraryChain.Open(e, r, ps[0].Id, T0);
        Assert.Equal("solved", e.SubmitAnswer(r, ps[0].Id, "h1-riddle", J("פך השמן"), T0).Code);
        Assert.True(e.Continue(r, ps[0].Id, T0).Ok);
        return (e, r, ps);
    }

    private static ActionOutcome Op(GameEngine e, GameRoom r, PlayerSession p, string puzzle, object action) => e.Operate(r, p.Id, puzzle, J(action), T0);
    private static PuzzleStatus Status(GameRoom r, string id) => r.Puzzles.First(p => p.PuzzleId == id).Status;
    private static WorldState W(GameRoom r) => GameEngine.World(r);
    private static int Personal(GameRoom r, PlayerSession p) => W(r).Score!.Personal.GetValueOrDefault(p.Id.ToString());

    [Fact]
    public void Wicks_light_test_and_blueprint_open_the_original_assembly_in_its_order()
    {
        var (e, r, ps) = InWorkshop(1);
        var p = ps[0];
        Assert.Equal(PuzzleStatus.Active, Status(r, "h2-wicks"));
        foreach (var id in new[] { "h2-test", "h2-blueprint", "h2-lamp" }) Assert.Equal(PuzzleStatus.Locked, Status(r, id));
        // the assembly scroll appears only with the blueprint
        Assert.Equal("locked", e.DiscoverClue(r, p.Id, "r2-scroll", T0).Code);

        // the wicks are taken straight from the table and go back to it
        foreach (var w in new[] { "w-short", "w-medium", "w-long", "w-star" }) Assert.Contains(w, W(r).WorldItems);
        Assert.True(Op(e, r, p, "h2-wicks", new { op = "place", slot = "v-small", item = "w-long" }).Ok);
        Assert.DoesNotContain("w-long", W(r).WorldItems);
        Assert.DoesNotContain("w-long", W(r).Inventory);
        Assert.True(Op(e, r, p, "h2-wicks", new { op = "remove", slot = "v-small" }).Ok);
        Assert.Contains("w-long", W(r).WorldItems);
        Assert.DoesNotContain("w-long", W(r).Inventory);
        // a full but wrong match is refused, the right one lights the table
        Assert.True(Op(e, r, p, "h2-wicks", new { op = "place", slot = "v-small", item = "w-medium" }).Ok);
        Assert.True(Op(e, r, p, "h2-wicks", new { op = "place", slot = "v-medium", item = "w-short" }).Ok);
        Assert.True(Op(e, r, p, "h2-wicks", new { op = "place", slot = "v-large", item = "w-long" }).Ok);
        Assert.Equal("placed-wrong", Op(e, r, p, "h2-wicks", new { op = "place", slot = "v-star", item = "w-star" }).Code);
        Assert.Equal("not-ready", Op(e, r, p, "h2-wicks", new { op = "activate" }).Code);
        Assert.True(Op(e, r, p, "h2-wicks", new { op = "remove", slot = "v-small" }).Ok);
        Assert.True(Op(e, r, p, "h2-wicks", new { op = "remove", slot = "v-medium" }).Ok);
        Assert.True(Op(e, r, p, "h2-wicks", new { op = "place", slot = "v-small", item = "w-short" }).Ok);
        Assert.Equal("solved", Op(e, r, p, "h2-wicks", new { op = "place", slot = "v-medium", item = "w-medium" }).Code);
        Assert.Equal(PuzzleStatus.Active, Status(r, "h2-test"));

        // the light test: only the third lamp casts a whole flame
        Assert.Equal("wrong", e.SubmitAnswer(r, p.Id, "h2-test", J("1"), T0).Code);
        Assert.Equal("solved", e.SubmitAnswer(r, p.Id, "h2-test", J("3"), T0).Code);
        Assert.Equal(PuzzleStatus.Active, Status(r, "h2-blueprint"));
        Assert.Equal(PuzzleStatus.Locked, Status(r, "h2-lamp"));

        Assert.Equal("solved", Op(e, r, p, "h2-blueprint", new { op = "inspect", target = "plate" }).Code);
        Assert.Equal(PuzzleStatus.Active, Status(r, "h2-lamp"));
        Assert.True(e.DiscoverClue(r, p.Id, "r2-scroll", T0).Ok);

        // the original assembly, unchanged: base → tank → wick → glass → cover
        string[] order = ["lamp-base", "lamp-tank", "lamp-wick", "lamp-glass", "lamp-cover"];
        foreach (var part in order) Assert.True(e.PickUp(r, p.Id, part, T0).Ok);
        Assert.Equal("wrong-place", Op(e, r, p, "h2-lamp", new { op = "place", slot = "s1", item = "lamp-tank" }).Code);
        for (var i = 0; i < 4; i++) Assert.True(Op(e, r, p, "h2-lamp", new { op = "place", slot = $"s{i + 1}", item = order[i] }).Ok);
        Assert.Equal("solved", Op(e, r, p, "h2-lamp", new { op = "place", slot = "s5", item = "lamp-cover" }).Code);
        Assert.Contains("menorah-symbol", W(r).Inventory);
        Assert.Contains("maze", e.UnlockedZones(r, Content));
        // no wick lingers in the bag: they all stay in the vessels
        Assert.DoesNotContain(W(r).Inventory, i => i.StartsWith("w-"));
    }

    [Fact]
    public void The_new_steps_score_once_with_their_own_values()
    {
        var (e, r, ps) = InWorkshop(4);
        var before = ps.Select(p => Personal(r, p)).ToArray();
        // the player who completes the match gets 10; placing wicks gives nothing on its own
        foreach (var (slot, item) in WorkshopChain.Wicks.Take(3)) Assert.True(Op(e, r, ps[1], "h2-wicks", new { op = "place", slot, item }).Ok);
        Assert.Equal(before[1], Personal(r, ps[1]));
        Assert.Equal("solved", Op(e, r, ps[2], "h2-wicks", new { op = "place", slot = "v-star", item = "w-star" }).Code);
        Assert.Equal(before[2] + 10, Personal(r, ps[2]));
        Assert.Equal(before[1], Personal(r, ps[1]));

        Assert.Equal("solved", e.SubmitAnswer(r, ps[3].Id, "h2-test", J("3"), T0).Code);
        Assert.Equal("already-solved", e.SubmitAnswer(r, ps[1].Id, "h2-test", J("3"), T0).Code);
        Assert.Equal(before[3] + 10, Personal(r, ps[3]));
        Assert.Equal("solved", Op(e, r, ps[1], "h2-blueprint", new { op = "inspect", target = "plate" }).Code);
        Assert.Equal("already-solved", Op(e, r, ps[0], "h2-blueprint", new { op = "inspect", target = "plate" }).Code);
        Assert.Equal(before[1] + 15, Personal(r, ps[1]));
        Assert.Equal(before[0], Personal(r, ps[0]));
        Assert.Equal(W(r).Score!.Log.Count, W(r).Score!.Log.Select(x => x.Key).Distinct().Count());
    }

    [Fact]
    public void The_scroll_gives_exactly_one_wick_per_vessel_and_matches_the_solution()
    {
        var data = Content.Puzzle("h2-wicks");
        var slots = data.PublicData["slots"]!.AsArray().ToDictionary(s => s!["mark"]!.GetValue<string>(), s => s!["id"]!.GetValue<string>());
        var scroll = data.PublicData["scroll"]!.AsArray();
        var solution = data.Solution["slots"]!.AsObject();
        Assert.Equal(4, slots.Count);                                     // four different marks
        Assert.Equal(4, scroll.Select(s => s!["wick"]!.GetValue<string>()).Distinct().Count());
        foreach (var s in scroll)
            Assert.Equal(s!["wick"]!.GetValue<string>(), solution[slots[s["mark"]!.GetValue<string>()]]!.GetValue<string>());
        // the fourth vessel and the special wick share the star, and the scroll says so in words
        Assert.Equal("w-star", solution["v-star"]!.GetValue<string>());
        Assert.Contains("כוכב", scroll.Single(s => s!["star"]?.GetValue<bool>() == true)!["text"]!.GetValue<string>());
        // the assembly order itself did not change
        Assert.Equal(["lamp-base", "lamp-tank", "lamp-wick", "lamp-glass", "lamp-cover"],
            new[] { "s1", "s2", "s3", "s4", "s5" }.Select(k => Content.Puzzle("h2-lamp").Solution["slots"]![k]!.GetValue<string>()));
    }

    [Fact]
    public void Four_players_and_a_single_player_both_finish_the_workshop()
    {
        foreach (var n in new[] { 1, 4 })
        {
            var (e, r, ps) = InWorkshop(n);
            WorkshopChain.Open(e, r, ps[n - 1].Id, T0);
            string[] order = ["lamp-base", "lamp-tank", "lamp-wick", "lamp-glass", "lamp-cover"];
            foreach (var part in order) Assert.True(e.PickUp(r, ps[0].Id, part, T0).Ok);
            for (var i = 0; i < 5; i++) Op(e, r, ps[i % n], "h2-lamp", new { op = "place", slot = $"s{i + 1}", item = order[i] });
            Assert.Equal(PuzzleStatus.Solved, Status(r, "h2-lamp"));
            Assert.Equal("maze", W(r).PendingZone);
        }
    }

    // ------------------------------------------------------------------ games saved before the workshop's new steps

    private static readonly string[] NewSteps = ["h2-wicks", "h2-test", "h2-blueprint"];

    [Fact]
    public void An_old_game_in_the_middle_of_the_assembly_carries_on_unchanged()
    {
        var (e, r, ps) = InWorkshop(2);
        WorkshopChain.Open(e, r, ps[0].Id, T0);
        Assert.True(e.PickUp(r, ps[1].Id, "lamp-base", T0).Ok);
        Assert.True(Op(e, r, ps[1], "h2-lamp", new { op = "place", slot = "s1", item = "lamp-base" }).Ok);
        // saved as an old game would be: no state for the new steps, and their wicks never laid out
        r.Puzzles.RemoveAll(p => NewSteps.Contains(p.PuzzleId));
        var w = W(r);
        foreach (var id in NewSteps) w.Mechanisms.Remove(id);
        r.WorldJson = JsonSerializer.Serialize(w, ScenarioCatalog.JsonOptions);
        var before = r.WorldJson;
        e.FillMissingPuzzles(r);
        foreach (var id in NewSteps) Assert.Equal(PuzzleStatus.Solved, Status(r, id));
        Assert.Equal(before, r.WorldJson);   // nothing laid out for steps already behind the group, and the score log is the same
        Assert.Equal(PuzzleStatus.Active, Status(r, "h2-lamp"));
        Assert.True(e.DiscoverClue(r, ps[0].Id, "r2-scroll", T0).Ok);
    }

    [Fact]
    public void An_old_game_still_in_the_library_finds_the_wicks_waiting_in_the_workshop()
    {
        var e = new GameEngine(Catalog, new GameOptions());
        var r = e.CreateRoom("hanukkah-oil", "OLD234", "hash", T0);
        Assert.True(e.AddPlayer(r, "ותיק", "explorer", "{}", "t0", true, T0, out var p).Ok);
        p!.IsConnected = true;
        Assert.True(e.StartGame(r, p.Id, T0).Ok);
        Assert.True(e.FinishIntro(r, p.Id, true, T0).Ok);
        r.Puzzles.RemoveAll(x => NewSteps.Contains(x.PuzzleId));
        var w = W(r);
        foreach (var id in NewSteps) w.Mechanisms.Remove(id);
        w.WorldItems.RemoveAll(i => i.StartsWith("w-"));
        r.WorldJson = JsonSerializer.Serialize(w, ScenarioCatalog.JsonOptions);

        e.FillMissingPuzzles(r);
        foreach (var id in NewSteps) Assert.Equal(PuzzleStatus.Locked, Status(r, id));
        foreach (var wick in new[] { "w-short", "w-medium", "w-long", "w-star" }) Assert.Contains(wick, W(r).WorldItems);
        Assert.Empty(W(r).Score!.Log);

        LibraryChain.Open(e, r, p.Id, T0);
        Assert.Equal("solved", e.SubmitAnswer(r, p.Id, "h1-riddle", J("פך השמן"), T0).Code);
        Assert.Equal(PuzzleStatus.Active, Status(r, "h2-wicks"));
        Assert.Equal(PuzzleStatus.Locked, Status(r, "h2-lamp"));
        WorkshopChain.Open(e, r, p.Id, T0);
        Assert.Equal(PuzzleStatus.Active, Status(r, "h2-lamp"));
    }
}
