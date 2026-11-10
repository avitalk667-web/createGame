using System.Text.Json.Nodes;
using PortalX.Server.Content;
using PortalX.Server.Domain;
using PortalX.Server.Game;
using static PortalX.Tests.GameEngineTests;
using Room1 = PortalX.Tests.GateOfSecretsRoom1Tests;

namespace PortalX.Tests;

/// <summary>
/// "שער הסודות", room 2 — the ancient mechanisms: the pipes (one unbroken way from the source to the tank, the drain shut
/// first), the hidden weights (one order fits the three engravings) and the end: the golden key from room 1 in the gate.
/// </summary>
public class GateOfSecretsRoom2Tests
{
    private static readonly DateTime T0 = new(2026, 12, 14, 18, 0, 0, DateTimeKind.Utc);
    private static ScenarioContent Gate => Catalog.Get("gate-of-secrets");
    private static JsonObject Pipes => Gate.Puzzle("g2-pipes").PublicData;
    /// <summary>The pieces of the one way through, and how they must lie (index = row × 5 + column).</summary>
    private static readonly Dictionary<int, int> Way = new() { [5] = 0, [6] = 3, [1] = 1, [2] = 0, [3] = 2, [8] = 1, [13] = 0 };
    private static readonly string[] Light2Heavy = ["w-candle", "w-clock", "w-cube", "w-book"];

    /// <summary>Room 1 played, the group in room 2.</summary>
    public static Room1.Game InRoom2(int players, string code = "GATE2X")
    {
        var g = Room1.Start(players, code);
        Room1.PlayRoom1(g);
        Assert.True(g.E.Continue(g.R, g.Ps[0].Id, T0.AddSeconds(2)).Ok);
        return g;
    }

    /// <summary>Turns every piece of the way into place (players taking turns).</summary>
    public static void LayPipes(Room1.Game g)
    {
        var k = 0;
        foreach (var (i, want) in Way)
        {
            var kind = Pipes["tiles"]![i / 5]!.GetValue<string>()[i % 5];
            while (g.World.Mechanisms["g2-pipes"].Rotations[i] % (kind == 'S' ? 2 : 4) != want)
                Assert.True(g.Op(k++, "g2-pipes", new { op = "rotate", index = i }, T0.AddSeconds(3)).Ok);
        }
    }

    public static void RunWater(Room1.Game g)
    {
        LayPipes(g);
        g.Op(0, "g2-pipes", new { op = "valve", id = "drain" }, T0.AddSeconds(3));
        Assert.Equal("solved", g.Op(1, "g2-pipes", new { op = "valve", id = "main" }, T0.AddSeconds(3)).Code);
    }

    public static void Weigh(Room1.Game g)
    {
        foreach (var (s, k) in Light2Heavy.Select((s, k) => (s, k))) Assert.True(g.E.PickUp(g.R, g.Ps[k % g.Ps.Count].Id, s, T0.AddSeconds(4)).Ok);
        for (var k = 0; k < 4; k++) g.Op(k, "g2-weights", new { op = "place", slot = $"p{k + 1}", item = Light2Heavy[k] }, T0.AddSeconds(4));
        Assert.Equal("solved", g.Op(2, "g2-weights", new { op = "activate" }, T0.AddSeconds(4)).Code);
    }

    // ------------------------------------------------------------------ the content

    [Fact]
    public void Room_2_has_exactly_two_puzzles_and_the_key_in_the_gate_is_the_end_not_a_third()
    {
        var room2 = Gate.Puzzles.Where(p => p.Zone == "gearworks").OrderBy(p => p.Order).ToList();
        Assert.Equal(["g2-pipes", "g2-weights", "g2-gate"], room2.Select(p => p.Id).ToArray());
        Assert.Equal(["g2-pipes", "g2-weights"], room2.Where(p => !GameEngine.IsFinale(p)).Select(p => p.Id).ToArray());
        Assert.True(GameEngine.IsFinale(Gate.Puzzle("g2-gate")));
        Assert.Equal("g2-pipes", Gate.Puzzle("g2-weights").RequiresPuzzle);
        Assert.Equal("g2-weights", Gate.Puzzle("g2-gate").RequiresPuzzle);
        Assert.Equal("gs-golden-key", Gate.Puzzle("g2-gate").PublicData["needsItem"]!.GetValue<string>());
        // no bonus, nothing else to solve, two rooms, and two graded hints for every puzzle
        Assert.DoesNotContain(Gate.Puzzles, p => p.Bonus);
        Assert.Equal(2, Gate.Zones.Count);
        Assert.All(Gate.Puzzles.Where(p => !GameEngine.IsFinale(p)), p => Assert.Equal(2, p.Hints.Count));
        Assert.Equal("חדר המנגנונים העתיקים", Gate.Zones.First(z => z.Id == "gearworks").Name);
        // the four stones carry objects only: a book, a candle, a clock and a cube
        Assert.Equal(["אבן הספר", "אבן הנר", "אבן השעון", "אבן הקובייה"], Gate.Items.Where(i => i.Id.StartsWith("w-")).Select(i => i.Name).ToArray());
        Assert.DoesNotContain(Gate.Items, i => i.Id.StartsWith("gear-"));
    }

    // ------------------------------------------------------------------ the pipes

    [Fact]
    public void Exactly_one_way_through_the_pipes_and_the_start_does_not_lead_there()
    {
        var turnable = Enumerable.Range(0, 15).Where(i => GameEngine.PipeTurns(Pipes, i)).ToList();
        var start = GameEngine.PipeStart(Pipes);
        Assert.False(GameEngine.PipeFlow(Pipes, start).Reached);
        // every way the turnable pieces can lie (a straight pipe has two, an elbow four)
        var paths = new HashSet<string>();
        var turns = start.ToList();
        var count = 0;
        void Try(int k)
        {
            if (k == turnable.Count)
            {
                var (cells, reached) = GameEngine.PipeFlow(Pipes, turns);
                if (reached) { count++; paths.Add(string.Join(" ", cells)); }
                return;
            }
            var i = turnable[k];
            var kind = Pipes["tiles"]![i / 5]!.GetValue<string>()[i % 5];
            for (var t = 0; t < (kind == 'S' ? 2 : 4); t++) { turns[i] = t; Try(k + 1); }
        }
        Try(0);
        Assert.Single(paths);
        Assert.Equal("1,0 1,1 0,1 0,2 0,3 1,3 2,3 2,4", paths.Single());
        Assert.True(count > 0);
        // the cracked piece and the tank's inlet are fixed in the wall
        Assert.False(GameEngine.PipeTurns(Pipes, 12));
        Assert.False(GameEngine.PipeTurns(Pipes, 14));
    }

    [Fact]
    public void The_pipes_take_the_drain_first_show_where_the_water_stops_and_open_the_weights()
    {
        var g = InRoom2(2);
        var at = T0.AddSeconds(3);
        Assert.Equal("locked", g.Op(0, "g2-weights", new { op = "activate" }, at).Code);
        Assert.Equal("fixed", g.Op(0, "g2-pipes", new { op = "rotate", index = 12 }, at).Code);   // the cracked pipe
        // the main valve with the drain still open: the water runs away, nothing fills
        var drained = g.Op(0, "g2-pipes", new { op = "valve", id = "main" }, at);
        Assert.Equal("drained", drained.Code);
        Assert.Contains("ניקוז", drained.Message);
        Assert.Empty(g.World.Mechanisms["g2-pipes"].Found);
        // the drain shut, the first piece turned in line, the rest not: the water stops part of the way (the players see where)
        Assert.True(g.Op(0, "g2-pipes", new { op = "rotate", index = 5 }, at).Ok);
        Assert.True(g.Op(1, "g2-pipes", new { op = "valve", id = "drain" }, at).Ok);
        var leaked = g.Op(0, "g2-pipes", new { op = "valve", id = "main" }, at);
        Assert.Equal("leaked", leaked.Code);
        Assert.Equal(["1,0"], g.World.Mechanisms["g2-pipes"].Found.ToArray());   // the first piece lies across: no further
        Assert.False(g.World.Mechanisms["g2-pipes"].Levers[0]);
        // trying again and again never locks the valve (it is a mechanism to explore, not a code to guess)
        for (var i = 0; i < 4; i++) Assert.Equal("leaked", g.Op(0, "g2-pipes", new { op = "valve", id = "main" }, at).Code);
        // the way in place: the water reaches the tank
        LayPipes(g);
        var ok = g.Op(1, "g2-pipes", new { op = "valve", id = "main" }, at);
        Assert.Equal("solved", ok.Code);
        Assert.Equal(8, g.World.Mechanisms["g2-pipes"].Found.Count);
        Assert.Contains("הספר כבד יותר מהקובייה", ok.Message);
        Assert.Equal(PuzzleStatus.Active, g.Status("g2-weights"));
        Assert.Equal("already-solved", g.Op(0, "g2-pipes", new { op = "rotate", index = 0 }, at).Code);
        // scored once, for the one who opened the water
        Assert.Single(g.World.Score!.Log, x => x.Key == "mechanism:g2-pipes");
    }

    // ------------------------------------------------------------------ the hidden weights

    [Fact]
    public void Exactly_one_order_of_the_stones_fits_the_three_engravings()
    {
        static IEnumerable<string[]> Perms(string[] xs) => xs.Length == 1 ? [xs]
            : xs.SelectMany(x => Perms(xs.Where(y => y != x).ToArray()).Select(rest => new[] { x }.Concat(rest).ToArray()));
        bool Heavier(string[] o, string a, string b) => Array.IndexOf(o, a) > Array.IndexOf(o, b);
        var fit = Perms(Light2Heavy).Where(o => Heavier(o, "w-book", "w-cube") && Heavier(o, "w-cube", "w-clock") && Heavier(o, "w-clock", "w-candle")).ToList();
        Assert.Single(fit);
        Assert.Equal(Light2Heavy, fit[0]);
        Assert.Contains("הספר כבד יותר מהקובייה", Gate.Puzzle("g2-pipes").Success);
        Assert.Contains("הקובייה כבדה יותר מהשעון", Gate.Clues.First(c => c.Id == "g2-cube").Text);
        Assert.Contains("השעון כבד יותר מהנר", Gate.Clues.First(c => c.Id == "g2-clock").Text);
        // no number and no weight anywhere the players can see
        var pub = Snapshots.PublicScenario(Gate).ToJsonString();
        Assert.DoesNotContain("\"weights\"", pub);
    }

    [Fact]
    public void The_weights_judge_only_the_whole_row_and_a_guessing_streak_rests_the_pads()
    {
        var g = InRoom2(1);
        RunWater(g);
        var at = T0.AddSeconds(5);
        foreach (var s in Light2Heavy) g.E.PickUp(g.R, g.Ps[0].Id, s, at);
        // wrong: book and candle swapped — accepted while laying, refused only as a whole, never telling which
        var wrongRow = new[] { "w-book", "w-clock", "w-cube", "w-candle" };
        for (var k = 0; k < 4; k++) Assert.True(g.Op(0, "g2-weights", new { op = "place", slot = $"p{k + 1}", item = wrongRow[k] }, at).Ok);
        var wrong = g.Op(0, "g2-weights", new { op = "activate" }, at);
        Assert.Equal("wrong-answer", wrong.Code);
        Assert.Empty(g.World.Mechanisms["g2-weights"].Verdict);
        g.Op(0, "g2-weights", new { op = "activate" }, at);
        Assert.Contains("ננעל", g.Op(0, "g2-weights", new { op = "activate" }, at).Message);
        Assert.Equal("cooldown", g.Op(0, "g2-weights", new { op = "activate" }, at).Code);
        // a stone moves from pad to pad (taken off and laid again)
        var later = at.AddSeconds(25);
        g.Op(0, "g2-weights", new { op = "remove", slot = "p1" }, later);
        g.Op(0, "g2-weights", new { op = "remove", slot = "p4" }, later);
        g.Op(0, "g2-weights", new { op = "place", slot = "p1", item = "w-candle" }, later);
        g.Op(0, "g2-weights", new { op = "place", slot = "p4", item = "w-book" }, later);
        Assert.Equal("solved", g.Op(0, "g2-weights", new { op = "activate" }, later).Code);
        Assert.Equal(PuzzleStatus.Active, g.Status("g2-gate"));
        Assert.Equal(RoomPhase.Playing, g.R.Phase);   // the gate waits for the key
    }

    // ------------------------------------------------------------------ the golden key and the end

    [Fact]
    public void The_golden_key_opens_the_gate_only_after_both_mechanisms_and_ends_the_game()
    {
        var g = InRoom2(2);
        var at = T0.AddSeconds(6);
        Assert.Equal("locked", g.Op(0, "g2-gate", new { op = "use" }, at).Code);
        RunWater(g);
        Assert.Equal("locked", g.Op(0, "g2-gate", new { op = "use" }, at).Code);
        Weigh(g);
        Assert.Contains("gs-golden-key", g.World.Inventory);
        var end = g.Op(1, "g2-gate", new { op = "use" }, at);
        Assert.Equal("solved", end.Code);
        Assert.Contains(end.Notices, n => n.Kind == "gate-key");
        Assert.Contains(end.Notices, n => n.Kind == "game-completed");
        Assert.Contains("עברתם את שער הסודות", end.Message);
        Assert.Equal(RoomPhase.Completed, g.R.Phase);
        Assert.DoesNotContain("gs-golden-key", g.World.Inventory);   // it stays in the lock
        // the key earns no points of its own; the room is complete (150 for the medium room)
        Assert.DoesNotContain(g.World.Score!.Log, x => x.Key == "mechanism:g2-gate");
        Assert.Equal(150, g.World.Score.Rooms["gearworks"]);
        // "solved X of Y" counts the six puzzles, not the key
        var result = g.E.BuildResult(g.R);
        Assert.Equal(6, result.PuzzlesTotal);
        Assert.Equal(6, result.PuzzlesSolved);
        Assert.Equal(6, g.World.Score.Solved.Values.Sum());   // the players' own "puzzles solved" leave the key out too
    }

    [Fact]
    public void Without_the_key_in_the_bag_the_gate_does_not_open()
    {
        var g = InRoom2(1);
        RunWater(g);
        Weigh(g);
        var w = g.World;
        w.Inventory.Remove("gs-golden-key");
        GameEngine.SaveWorld(g.R, w, T0);
        Assert.Equal("item-missing", g.Op(0, "g2-gate", new { op = "use" }, T0.AddSeconds(7)).Code);
        Assert.Equal(RoomPhase.Playing, g.R.Phase);
    }

    // ------------------------------------------------------------------ the whole game, alone and in groups

    [Theory]
    [InlineData(1)]
    [InlineData(2)]
    [InlineData(4)]
    public void The_whole_free_game_plays_through_with_one_two_or_four_players(int players)
    {
        var g = InRoom2(players, "WHOLE" + players);
        RunWater(g);
        Weigh(g);
        Assert.Equal("solved", g.Op(players - 1, "g2-gate", new { op = "use" }, T0.AddSeconds(8)).Code);
        Assert.Equal(RoomPhase.Completed, g.R.Phase);
        var score = g.World.Score!;
        Assert.Equal(250, score.Group);   // 100 + 150, no hints
        Assert.Equal(score.Log.Count, score.Log.Select(x => x.Key).Distinct().Count());
        Assert.All(g.Ps, p => Assert.True(score.Personal.GetValueOrDefault(p.Id.ToString()) > 0));
    }

    [Fact]
    public void A_hint_in_room_2_costs_that_room_ten_points()
    {
        var g = InRoom2(1);
        Assert.True(g.E.RequestHint(g.R, g.Ps[0].Id, "g2-pipes", T0.AddSeconds(3)).Ok);
        RunWater(g);
        Weigh(g);
        g.Op(0, "g2-gate", new { op = "use" }, T0.AddSeconds(8));
        Assert.Equal(140, g.World.Score!.Rooms["gearworks"]);
        Assert.Equal(100, g.World.Score.Rooms["maproom"]);
    }
}
