using System.Text.Json;
using PortalX.Server.Content;
using PortalX.Server.Domain;
using PortalX.Server.Game;
using static PortalX.Tests.GameEngineTests;

namespace PortalX.Tests;

/// <summary>The oil lab's preparation before the original four jugs: the jar shelf and the oil scales.</summary>
public static class LabChain
{
    public static readonly (string Slot, string Item)[] Shelf = [("p1", "jar-gold"), ("p2", "jar-small"), ("p3", "jar-blue"), ("p4", "jar-flame")];

    public static void Open(GameEngine e, GameRoom r, Guid player, DateTime t)
    {
        foreach (var (slot, item) in Shelf) Assert.True(e.Operate(r, player, "h6-shelf", J(new { op = "place", slot, item }), t).Ok);
        Assert.Equal("solved", e.Operate(r, player, "h6-scales", J(new { op = "place", slot = "pan", item = "bottle-blue" }), t).Code);
    }

    public const int Points = 10 + 15;
}

public class LabRoomTests
{
    private static readonly DateTime T0 = new(2026, 12, 14, 18, 0, 0, DateTimeKind.Utc);
    private static ScenarioContent Content => Catalog.Get("hanukkah-oil");

    /// <summary>A game whose group stands in the oil lab (rooms 1–5 played by the first player).</summary>
    private static (GameEngine e, GameRoom r, List<PlayerSession> ps) InLab(int players)
    {
        var e = new GameEngine(Catalog, new GameOptions());
        var r = e.CreateRoom("hanukkah-oil", "LAB234", "hash", T0);
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
        var me = ps[0].Id;
        LibraryChain.Open(e, r, me, T0);
        Assert.Equal("solved", e.SubmitAnswer(r, me, "h1-riddle", J("פך השמן"), T0).Code);
        WorkshopChain.Open(e, r, me, T0);
        string[] order = ["lamp-base", "lamp-tank", "lamp-wick", "lamp-glass", "lamp-cover"];
        foreach (var part in order) Assert.True(e.PickUp(r, me, part, T0).Ok);
        for (var i = 0; i < 5; i++) e.Operate(r, me, "h2-lamp", J(new { op = "place", slot = $"s{i + 1}", item = order[i] }), T0);
        var t = T0;
        void Go(string dirs) { foreach (var d in dirs) e.Operate(r, me, "h3-maze", J(new { op = "move", dir = d.ToString() }), t = t.AddMilliseconds(300)); }
        void Lever(int i) => e.Operate(r, me, "h3-maze", J(new { op = "lever", index = i }), t);
        Go("EE"); Lever(0); Go("EEEESSW"); Lever(1); Go("WWWSS"); Lever(2); Go("EEEE");
        Assert.Equal("solved", e.SubmitAnswer(r, me, "h3-box", J("825"), T0).Code);
        CipherChain.Open(e, r, me, T0);
        Assert.Equal("solved", e.SubmitAnswer(r, me, "h4-wheel", J("אור"), T0).Code);
        DreidelChain.Open(e, r, me, T0);
        foreach (var d in new[] { "dreidel-nun", "dreidel-gimel", "dreidel-he", "dreidel-pe" }) Assert.True(e.PickUp(r, me, d, T0).Ok);
        foreach (var (slot, item) in new[] { ("tl", "dreidel-nun"), ("tr", "dreidel-gimel"), ("bl", "dreidel-pe"), ("br", "dreidel-he") })
            e.Operate(r, me, "h5-stand", J(new { op = "place", slot, item }), T0);
        Assert.Equal("solved", e.SubmitAnswer(r, me, "h5-lock", J("4826"), T0).Code);
        Assert.True(e.Continue(r, me, T0).Ok);
        return (e, r, ps);
    }

    private static ActionOutcome Op(GameEngine e, GameRoom r, PlayerSession p, string puzzle, object action) => e.Operate(r, p.Id, puzzle, J(action), T0);
    private static PuzzleStatus Status(GameRoom r, string id) => r.Puzzles.First(p => p.PuzzleId == id).Status;
    private static WorldState W(GameRoom r) => GameEngine.World(r);
    private static int Personal(GameRoom r, PlayerSession p) => W(r).Score!.Personal.GetValueOrDefault(p.Id.ToString());

    [Fact]
    public void Shelf_and_scales_open_the_original_jugs_whose_answer_is_still_jug_aleph()
    {
        var (e, r, ps) = InLab(1);
        var p = ps[0];
        Assert.Equal(PuzzleStatus.Active, Status(r, "h6-shelf"));
        Assert.Equal(PuzzleStatus.Locked, Status(r, "h6-scales"));
        Assert.Equal(PuzzleStatus.Locked, Status(r, "h6-jugs"));
        Assert.Equal("locked", e.DiscoverClue(r, p.Id, "r6-sign", T0).Code);   // the sign lights up with the scales

        // a full shelf in a wrong order is refused; the jars go back to the bench, never into the bag
        foreach (var (slot, item) in new[] { ("p1", "jar-blue"), ("p2", "jar-small"), ("p3", "jar-gold") })
            Assert.True(Op(e, r, p, "h6-shelf", new { op = "place", slot, item }).Ok);
        Assert.Equal("placed-wrong", Op(e, r, p, "h6-shelf", new { op = "place", slot = "p4", item = "jar-flame" }).Code);
        Assert.True(Op(e, r, p, "h6-shelf", new { op = "remove", slot = "p1" }).Ok);
        Assert.True(Op(e, r, p, "h6-shelf", new { op = "remove", slot = "p3" }).Ok);
        Assert.Contains("jar-blue", W(r).WorldItems);
        Assert.DoesNotContain("jar-blue", W(r).Inventory);
        Assert.True(Op(e, r, p, "h6-shelf", new { op = "place", slot = "p1", item = "jar-gold" }).Ok);
        Assert.Equal("solved", Op(e, r, p, "h6-shelf", new { op = "place", slot = "p3", item = "jar-blue" }).Code);
        Assert.Equal(PuzzleStatus.Active, Status(r, "h6-scales"));

        // the scales: 100 g and 500 g leave them tilted, 300 g balances them
        Assert.Equal("placed-wrong", Op(e, r, p, "h6-scales", new { op = "place", slot = "pan", item = "bottle-green" }).Code);
        Assert.True(Op(e, r, p, "h6-scales", new { op = "remove", slot = "pan" }).Ok);
        Assert.Equal("placed-wrong", Op(e, r, p, "h6-scales", new { op = "place", slot = "pan", item = "bottle-red" }).Code);
        Assert.True(Op(e, r, p, "h6-scales", new { op = "remove", slot = "pan" }).Ok);
        Assert.Equal("solved", Op(e, r, p, "h6-scales", new { op = "place", slot = "pan", item = "bottle-blue" }).Code);
        Assert.Equal(PuzzleStatus.Active, Status(r, "h6-jugs"));
        Assert.True(e.DiscoverClue(r, p.Id, "r6-sign", T0).Ok);

        // the original four jugs: only one statement is true when the pure oil is in jug א
        Assert.Equal("wrong", e.SubmitAnswer(r, p.Id, "h6-jugs", J("ב"), T0).Code);
        Assert.Equal("solved", e.SubmitAnswer(r, p.Id, "h6-jugs", J("א"), T0).Code);
        Assert.Contains("golden-jug", W(r).Inventory);
        Assert.Contains("mosaic", e.UnlockedZones(r, Content));
        // the bottles that were not the answer stay by the scales, they do not fill the bag
        Assert.DoesNotContain(W(r).Inventory, i => i.StartsWith("bottle-") || i.StartsWith("jar-"));
    }

    [Fact]
    public void The_four_clues_allow_exactly_one_shelf_gold_small_blue_flame()
    {
        string[] jars = ["jar-blue", "jar-gold", "jar-flame", "jar-small"];
        IEnumerable<string[]> Perms(string[] a) => a.Length <= 1 ? [a] : a.SelectMany((x, i) => Perms(a.Where((_, k) => k != i).ToArray()).Select(q => new[] { x }.Concat(q).ToArray()));
        bool Fits(string[] q, bool withFourth)
        {
            int At(string j) => Array.IndexOf(q, j) + 1;
            return Math.Abs(At("jar-blue") - At("jar-gold")) != 1           // blue is not next to gold
                && (At("jar-flame") == 1 || At("jar-flame") == 4)            // the flame jar is at an end
                && At("jar-small") != 4                                      // the small jar is not last
                && (!withFourth || At("jar-gold") == 1);                     // the added clue: gold at the left end
        }
        Assert.Equal(4, Perms(jars).Count(q => Fits(q, false)));             // the three original clues leave four shelves
        var only = Assert.Single(Perms(jars).Where(q => Fits(q, true)));
        Assert.Equal(["jar-gold", "jar-small", "jar-blue", "jar-flame"], only);
        var solution = Content.Puzzle("h6-shelf").Solution["slots"]!.AsObject();
        Assert.Equal(only, new[] { "p1", "p2", "p3", "p4" }.Select(s => solution[s]!.GetValue<string>()).ToArray());
        Assert.Equal("הכד המוזהב נמצא בקצה השמאלי.", Content.Puzzle("h6-shelf").PublicData["clues"]!.AsArray()[3]!.GetValue<string>());
    }

    [Fact]
    public void The_weights_agree_with_the_facts_and_only_the_half_bottle_balances()
    {
        var data = Content.Puzzle("h6-scales").PublicData;
        var w = data["weights"]!.AsObject().ToDictionary(kv => kv.Key, kv => kv.Value!.GetValue<int>());
        var counter = data["counterweight"]!.GetValue<int>();
        Assert.Equal([100, 300, 500], w.Values.OrderBy(x => x));
        Assert.Equal((100 + 500) / 2, counter);
        Assert.Single(w, kv => kv.Value == counter);
        Assert.Equal(w.Single(kv => kv.Value == counter).Key, Content.Puzzle("h6-scales").Solution["slots"]!["pan"]!.GetValue<string>());
        // the original jugs keep their statements and answer
        Assert.Equal("א", Content.Puzzle("h6-jugs").Solution["text"]!.GetValue<string>());
        Assert.Equal(4, Content.Puzzle("h6-jugs").PublicData["jugs"]!.AsArray().Count);
    }

    [Fact]
    public void Each_step_scores_once_for_the_player_who_did_it()
    {
        var (e, r, ps) = InLab(4);
        var b = ps.Select(p => Personal(r, p)).ToArray();
        foreach (var (slot, item) in LabChain.Shelf.Take(3)) Assert.True(Op(e, r, ps[0], "h6-shelf", new { op = "place", slot, item }).Ok);
        Assert.Equal("solved", Op(e, r, ps[1], "h6-shelf", new { op = "place", slot = "p4", item = "jar-flame" }).Code);
        Assert.Equal(b[0], Personal(r, ps[0]));                 // placing a jar gives nothing on its own
        Assert.Equal(b[1] + 10, Personal(r, ps[1]));
        Assert.Equal("placed-wrong", Op(e, r, ps[2], "h6-scales", new { op = "place", slot = "pan", item = "bottle-red" }).Code);
        Assert.True(Op(e, r, ps[2], "h6-scales", new { op = "remove", slot = "pan" }).Ok);
        Assert.Equal("solved", Op(e, r, ps[3], "h6-scales", new { op = "place", slot = "pan", item = "bottle-blue" }).Code);
        Assert.Equal(b[2], Personal(r, ps[2]));
        Assert.Equal(b[3] + 15, Personal(r, ps[3]));
        Assert.Equal(W(r).Score!.Log.Count, W(r).Score!.Log.Select(x => x.Key).Distinct().Count());
    }

    [Fact]
    public void Four_players_and_a_single_player_both_reach_the_mosaic()
    {
        foreach (var n in new[] { 1, 4 })
        {
            var (e, r, ps) = InLab(n);
            LabChain.Open(e, r, ps[n - 1].Id, T0);
            Assert.Equal("solved", e.SubmitAnswer(r, ps[0].Id, "h6-jugs", J("א"), T0).Code);
            Assert.Equal("mosaic", W(r).PendingZone);
        }
    }

    private static readonly string[] NewSteps = ["h6-shelf", "h6-scales"];

    [Fact]
    public void An_old_game_already_at_the_jugs_carries_on_unchanged()
    {
        var (e, r, ps) = InLab(2);
        LabChain.Open(e, r, ps[0].Id, T0);
        Assert.True(e.DiscoverClue(r, ps[1].Id, "r6-sign", T0).Ok);
        r.Puzzles.RemoveAll(p => NewSteps.Contains(p.PuzzleId));
        var w = W(r);
        foreach (var id in NewSteps) w.Mechanisms.Remove(id);
        w.WorldItems.RemoveAll(i => i.StartsWith("jar-") || i.StartsWith("bottle-"));
        r.WorldJson = JsonSerializer.Serialize(w, ScenarioCatalog.JsonOptions);
        var before = r.WorldJson;
        e.FillMissingPuzzles(r);
        foreach (var id in NewSteps) Assert.Equal(PuzzleStatus.Solved, Status(r, id));
        Assert.Equal(before, r.WorldJson);
        Assert.Equal(PuzzleStatus.Active, Status(r, "h6-jugs"));
        Assert.Equal("solved", e.SubmitAnswer(r, ps[1].Id, "h6-jugs", J("א"), T0).Code);
    }

    [Fact]
    public void An_old_game_still_before_the_lab_finds_jars_and_bottles_waiting_there()
    {
        var e = new GameEngine(Catalog, new GameOptions());
        var r = e.CreateRoom("hanukkah-oil", "OLL234", "hash", T0);
        Assert.True(e.AddPlayer(r, "ותיק", "explorer", "{}", "t0", true, T0, out var p).Ok);
        p!.IsConnected = true;
        Assert.True(e.StartGame(r, p.Id, T0).Ok);
        Assert.True(e.FinishIntro(r, p.Id, true, T0).Ok);
        r.Puzzles.RemoveAll(x => NewSteps.Contains(x.PuzzleId));
        var w = W(r);
        foreach (var id in NewSteps) w.Mechanisms.Remove(id);
        w.WorldItems.RemoveAll(i => i.StartsWith("jar-") || i.StartsWith("bottle-"));
        r.WorldJson = JsonSerializer.Serialize(w, ScenarioCatalog.JsonOptions);
        e.FillMissingPuzzles(r);
        foreach (var id in NewSteps) Assert.Equal(PuzzleStatus.Locked, Status(r, id));
        foreach (var it in new[] { "jar-blue", "jar-gold", "jar-flame", "jar-small", "bottle-red", "bottle-green", "bottle-blue" })
            Assert.Contains(it, W(r).WorldItems);
        Assert.Empty(W(r).Score!.Log);
    }
}
