using System.Text.Json;
using PortalX.Server.Domain;
using PortalX.Server.Game;
using static PortalX.Tests.GameEngineTests;

namespace PortalX.Tests;

/// <summary>
/// "מבוך האבן", room 2 — the Mechanism Workshop: chains and levers (balance A, B, C at 2), the energy rail (moon → sun →
/// star into the core), turning gravity over (three ceiling signs in the order rune, chain, star open the cell with the exit
/// code) and the exit gate, which only that code opens, only the right way up, and only after the room is done. Plus the whole
/// game and its score table (at most 440: personal 190 with the chest, group 250).
/// </summary>
public class StoneMazeRoom2Tests
{
    private static readonly DateTime T0 = new(2026, 12, 14, 18, 0, 0, DateTimeKind.Utc);

    private sealed record Game(GameEngine E, GameRoom R, List<PlayerSession> Ps)
    {
        public ActionOutcome Op(int who, string puzzle, object action, DateTime? at = null) => E.Operate(R, Ps[who % Ps.Count].Id, puzzle, J(action), at ?? T0);
        public WorldState World => GameEngine.World(R);
        public MechanismState Mech(string id) => World.Mechanisms[id];
        public PuzzleStatus Status(string id) => R.Puzzles.First(p => p.PuzzleId == id).Status;
        public int Personal => World.Score!.Personal.Values.Sum();
        public int Group => World.Score!.Group;
    }

    private static Game Start(int players)
    {
        var e = new GameEngine(Catalog, new GameOptions());
        var r = e.CreateRoom("stone-maze", "GATE" + players + "Y", "hash", T0);
        var ps = new List<PlayerSession>();
        for (var i = 0; i < players; i++)
        {
            Assert.True(e.AddPlayer(r, "שחקן" + i, GameEngine.Characters[i], "{}", "t" + i, i == 0, T0, out var p).Ok);
            p!.IsConnected = true;
            ps.Add(p);
        }
        for (var i = 1; i < players; i++) e.SetReady(r, ps[i].Id, true);
        Assert.True(e.StartGame(r, ps[0].Id, T0).Ok);
        Assert.True(e.FinishIntro(r, ps[0].Id, true, T0).Ok);
        return new Game(e, r, ps);
    }

    /// <summary>Plays room 1 to its end (the door with the key from the cabinet) and moves the group into room 2.</summary>
    private static Game InRoom2(int players, bool chest = false)
    {
        var g = Start(players);
        StoneMazeRoom1Tests.PlayRoom1(g.E, g.R, g.Ps, T0);
        if (chest) Assert.Equal("solved", g.Op(players - 1, "g1-chest", new { op = "open" }).Code);
        StoneMazeDoorTests.ThroughTheStoneDoor(g.E, g.R, g.Ps, T0);
        return g;
    }

    public static void Levers(GameEngine e, GameRoom r, IList<PlayerSession> ps, DateTime t)
    {
        string last = "";
        var pulls = new[] { "B", "B", "C", "C" };
        for (var k = 0; k < pulls.Length; k++) last = e.Operate(r, ps[k % ps.Count].Id, "g2-levers", J(new { op = "pull", lever = pulls[k] }), t).Code;
        Assert.Equal("solved", last);
    }

    public static void Rails(GameEngine e, GameRoom r, IList<PlayerSession> ps, DateTime t)
    {
        Assert.Equal("started", e.Operate(r, ps[0].Id, "g2-rails", J(new { op = "start" }), t).Code);
        var steps = new[] { "moon", "sun", "star" };
        string last = "";
        for (var k = 0; k < 3; k++) last = e.Operate(r, ps[(k + 1) % ps.Count].Id, "g2-rails", J(new { op = "choose", rail = steps[k] }), t).Code;
        Assert.Equal("solved", last);
    }

    public static void Gravity(GameEngine e, GameRoom r, IList<PlayerSession> ps, DateTime t)
    {
        Assert.Equal("flipped", e.Operate(r, ps[0].Id, "g2-gravity", J(new { op = "flip" }), t).Code);
        Assert.Equal("solved", e.Operate(r, ps[^1].Id, "g2-gravity", J(new { op = "order", signs = new[] { "rune", "chain", "star" } }), t.AddSeconds(3)).Code);
        Assert.Equal("restored", e.Operate(r, ps[0].Id, "g2-gravity", J(new { op = "flip" }), t.AddSeconds(6)).Code);
    }

    /// <summary>Room 2 from its start to the open gate.</summary>
    public static void PlayRoom2(GameEngine e, GameRoom r, IList<PlayerSession> ps, DateTime t, bool readInscription = true)
    {
        if (readInscription) Assert.True(e.DiscoverClue(r, ps[0].Id, "g2-inscription", t).Ok);
        Levers(e, r, ps, t);
        Rails(e, r, ps, t);
        Gravity(e, r, ps, t);
        Assert.Equal("solved", e.Operate(r, ps[^1].Id, "g2-gate", J(new { op = "unlock", code = "5819" }), t.AddSeconds(10)).Code);
    }

    // ------------------------------------------------------------------ the move into room 2

    [Fact]
    public void The_stone_door_opens_the_workshop_and_everyone_moves_in_together()
    {
        var g = InRoom2(2);
        Assert.Equal("gearworks", g.World.CurrentZone);
        Assert.Null(g.World.PendingZone);
        Assert.Equal(PuzzleStatus.Active, g.Status("g2-levers"));
        Assert.Equal(PuzzleStatus.Locked, g.Status("g2-rails"));
        Assert.Equal(PuzzleStatus.Locked, g.Status("g2-gravity"));
        Assert.Equal(PuzzleStatus.Locked, g.Status("g2-gate"));
        Assert.Equal(100, g.World.Score!.Rooms["maproom"]);
    }

    // ------------------------------------------------------------------ puzzle 4: chains and levers

    [Fact]
    public void Every_lever_state_from_the_start_can_still_reach_the_target_and_none_is_a_dead_end()
    {
        // breadth-first over all states reachable from 4, 0, 2 (the same transition the server uses)
        var start = new[] { 4, 0, 2 };
        var seen = new Dictionary<string, int[]> { [string.Join(",", start)] = start };
        var queue = new Queue<int[]>([start]);
        while (queue.Count > 0)
        {
            var s = queue.Dequeue();
            for (var l = 0; l < 3; l++)
                if (GameEngine.PullLever(s, l) is { } n && seen.TryAdd(string.Join(",", n), n)) queue.Enqueue(n);
        }
        Assert.Equal(19, seen.Count);
        Assert.Contains("2,2,2", seen.Keys);
        foreach (var s in seen.Values)
        {
            Assert.True(Enumerable.Range(0, 3).Any(l => GameEngine.PullLever(s, l) != null), $"stuck at {string.Join(",", s)}");
            // from every state the target is still reachable
            var reach = new HashSet<string> { string.Join(",", s) };
            var q = new Queue<int[]>([s]);
            while (q.Count > 0) { var x = q.Dequeue(); for (var l = 0; l < 3; l++) if (GameEngine.PullLever(x, l) is { } n && reach.Add(string.Join(",", n))) q.Enqueue(n); }
            Assert.Contains("2,2,2", reach);
        }
    }

    [Fact]
    public void A_pull_that_would_leave_the_range_is_refused_and_reset_returns_to_the_start()
    {
        var g = InRoom2(1);
        var stuck = g.Op(0, "g2-levers", new { op = "pull", lever = "A" });   // A is at 4 already
        Assert.Equal("stuck", stuck.Code);
        Assert.Contains("נתקעה", stuck.Message);
        g.Op(0, "g2-levers", new { op = "pull", lever = "B" });
        Assert.Equal([4, 1, 1], g.Mech("g2-levers").Rotations);
        Assert.Equal("reset", g.Op(0, "g2-levers", new { op = "reset" }).Code);
        Assert.Equal([4, 0, 2], g.Mech("g2-levers").Rotations);
        Assert.Equal(PuzzleStatus.Locked, g.Status("g2-rails"));
        Levers(g.E, g.R, g.Ps, T0);
        Assert.Equal(PuzzleStatus.Active, g.Status("g2-rails"));            // the levers wake the rail board — no door
        Assert.Null(g.World.PendingZone);
        Assert.NotEqual(RoomPhase.Completed, g.R.Phase);
    }

    // ------------------------------------------------------------------ puzzle 5: the energy rail

    [Fact]
    public void The_rail_network_has_dead_ends_loops_back_and_one_way_into_the_core()
    {
        var g = InRoom2(2);
        Levers(g.E, g.R, g.Ps, T0);
        Assert.Equal("not-started", g.Op(0, "g2-rails", new { op = "choose", rail = "moon" }).Code);
        g.Op(0, "g2-rails", new { op = "start" });
        Assert.Equal("J1", g.Mech("g2-rails").Revealed);
        Assert.Equal("dead-end", g.Op(1, "g2-rails", new { op = "choose", rail = "sun" }).Code);
        Assert.Equal("not-started", g.Op(1, "g2-rails", new { op = "choose", rail = "moon" }).Code);
        g.Op(0, "g2-rails", new { op = "start" });
        Assert.Equal("back-to-start", g.Op(0, "g2-rails", new { op = "choose", rail = "star" }).Code);   // J1 star → the start
        g.Op(0, "g2-rails", new { op = "start" });
        Assert.Equal("junction", g.Op(1, "g2-rails", new { op = "choose", rail = "moon" }).Code);         // → J2
        Assert.Equal("junction", g.Op(1, "g2-rails", new { op = "choose", rail = "star" }).Code);         // J2 star → back to J1
        Assert.Equal("J1", g.Mech("g2-rails").Revealed);
        g.Op(0, "g2-rails", new { op = "choose", rail = "moon" });
        g.Op(0, "g2-rails", new { op = "choose", rail = "sun" });                                         // → J3
        Assert.Equal("junction", g.Op(0, "g2-rails", new { op = "choose", rail = "sun" }).Code);          // J3 sun → back to J2
        g.Op(0, "g2-rails", new { op = "choose", rail = "sun" });                                         // → J3 again
        Assert.Equal("solved", g.Op(1, "g2-rails", new { op = "choose", rail = "star" }).Code);           // → the core
        Assert.Equal(PuzzleStatus.Active, g.Status("g2-gravity"));
        Assert.Null(g.World.PendingZone);
    }

    [Fact]
    public void The_rail_graph_stays_on_the_server_and_its_only_simple_path_is_moon_sun_star()
    {
        var scenario = Snapshots.PublicScenario(Catalog.Get("stone-maze")).ToJsonString();
        Assert.DoesNotContain("\"graph\"", scenario);
        Assert.DoesNotContain("\"core\"", scenario);
        var graph = Catalog.Get("stone-maze").Puzzle("g2-rails").Solution["graph"]!.AsObject();
        var found = new List<string>();
        void Walk(string node, List<string> path, HashSet<string> seen)
        {
            foreach (var (sym, to) in graph[node]!.AsObject())
            {
                var dest = to!.GetValue<string>();
                if (dest == "core") found.Add(string.Join("→", path.Append(sym)));
                else if (graph.ContainsKey(dest) && seen.Add(dest)) { Walk(dest, [.. path, sym], seen); seen.Remove(dest); }
            }
        }
        Walk("J1", [], ["J1"]);
        Assert.Equal(["moon→sun→star"], found);
    }

    // ------------------------------------------------------------------ puzzle 6: turning gravity over

    [Fact]
    public void The_signs_can_be_set_only_upside_down_a_wrong_order_resets_and_the_right_one_shows_the_exit_code()
    {
        var g = InRoom2(1);
        Levers(g.E, g.R, g.Ps, T0);
        Rails(g.E, g.R, g.Ps, T0);
        var right = new[] { "rune", "chain", "star" };
        Assert.Equal("hidden", g.Op(0, "g2-gravity", new { op = "order", signs = right }).Code);       // the signs are on the ceiling
        Assert.Equal("flipped", g.Op(0, "g2-gravity", new { op = "flip" }).Code);
        Assert.Equal("turning", g.Op(0, "g2-gravity", new { op = "flip" }, T0.AddSeconds(1)).Code);    // not during the turn
        Assert.Equal("hidden", g.Op(0, "g2-gravity", new { op = "order", signs = right }, T0.AddSeconds(1)).Code);
        Assert.Equal("wrong", g.Op(0, "g2-gravity", new { op = "order", signs = new[] { "star", "chain", "rune" } }, T0.AddSeconds(3)).Code);
        Assert.Null(g.Mech("g2-gravity").Revealed);                                                    // no code for a wrong order
        Assert.Equal("bad-order", g.Op(0, "g2-gravity", new { op = "order", signs = new[] { "rune", "rune", "star" } }, T0.AddSeconds(3)).Code);
        Assert.Equal("solved", g.Op(0, "g2-gravity", new { op = "order", signs = right }, T0.AddSeconds(4)).Code);
        Assert.Equal("5819", g.Mech("g2-gravity").Revealed);
        Assert.NotEqual(RoomPhase.Completed, g.R.Phase);                                              // the cell is not the end
        // the room turns back even though the puzzle is solved (only "flip" is allowed then)
        Assert.Equal("restored", g.Op(0, "g2-gravity", new { op = "flip" }, T0.AddSeconds(6)).Code);
        Assert.False(g.Op(0, "g2-gravity", new { op = "order", signs = right }, T0.AddSeconds(9)).Ok);
    }

    [Fact]
    public void The_exit_code_is_not_public_until_the_cell_opens()
    {
        var g = InRoom2(1);
        Levers(g.E, g.R, g.Ps, T0);
        Rails(g.E, g.R, g.Ps, T0);
        g.Op(0, "g2-gravity", new { op = "flip" });
        var snap = JsonSerializer.Serialize(Snapshots.Build(g.E, g.R, null, T0.AddSeconds(3)));
        Assert.DoesNotContain("5819", snap);
        Assert.DoesNotContain("5819", Snapshots.PublicScenario(Catalog.Get("stone-maze")).ToJsonString());
    }

    // ------------------------------------------------------------------ the exit gate

    [Fact]
    public void The_gate_opens_only_after_the_room_only_the_right_way_up_and_only_with_the_exit_code()
    {
        var g = InRoom2(2);
        var unlock = (string code, int s) => g.Op(1, "g2-gate", new { op = "unlock", code }, T0.AddSeconds(s));
        Assert.Equal("locked", unlock("5819", 0).Code);                     // with the right code, but nothing done
        g.R.Puzzles.First(p => p.PuzzleId == "g2-gate").Status = PuzzleStatus.Active;   // a tampered state
        Assert.Equal("room-not-done", unlock("5819", 0).Code);
        g.R.Puzzles.First(p => p.PuzzleId == "g2-gate").Status = PuzzleStatus.Locked;
        Levers(g.E, g.R, g.Ps, T0);
        Rails(g.E, g.R, g.Ps, T0);
        g.Op(0, "g2-gravity", new { op = "flip" });
        g.Op(0, "g2-gravity", new { op = "order", signs = new[] { "rune", "chain", "star" } }, T0.AddSeconds(3));
        Assert.Equal("flipped", unlock("5819", 4).Code);                    // the room is still upside down
        g.Op(0, "g2-gravity", new { op = "flip" }, T0.AddSeconds(5));
        Assert.Equal("flipped", unlock("5819", 6).Code);                    // still turning back
        Assert.Equal("wrong", unlock("1234", 8).Code);
        Assert.NotEqual(RoomPhase.Completed, g.R.Phase);
        Assert.Equal("solved", unlock("5819", 9).Code);
        Assert.Equal(RoomPhase.Completed, g.R.Phase);
        Assert.Null(g.World.PendingZone);                                   // the gate opens no room: the game is over
    }

    [Fact]
    public void No_room_two_puzzle_opens_a_door_or_ends_the_game()
    {
        var g = InRoom2(1);
        Levers(g.E, g.R, g.Ps, T0);
        Assert.NotEqual(RoomPhase.Completed, g.R.Phase);
        Rails(g.E, g.R, g.Ps, T0);
        Assert.NotEqual(RoomPhase.Completed, g.R.Phase);
        Gravity(g.E, g.R, g.Ps, T0);
        Assert.NotEqual(RoomPhase.Completed, g.R.Phase);
        Assert.Null(g.World.PendingZone);
        Assert.Equal(PuzzleStatus.Active, g.Status("g2-gate"));
    }

    // ------------------------------------------------------------------ the whole game and its score table

    [Theory]
    [InlineData(1)]
    [InlineData(2)]
    [InlineData(4)]
    public void A_full_game_scores_exactly_the_table_440_with_the_chest_430_without(int players)
    {
        foreach (var chest in new[] { true, false })
        {
            var g = InRoom2(players, chest);
            PlayRoom2(g.E, g.R, g.Ps, T0);
            Assert.Equal(RoomPhase.Completed, g.R.Phase);
            var s = g.World.Score!;
            // personal: room 1 = inscription 5 + stops 3×5 + pendulum 20 + map 20 + rune stages 3×5 + runes 20 + cabinet 20 = 115
            //           room 2 = inscription 5 + levers 20 + rail 20 + gravity 20 = 65 · chest 10 · the doors 0
            Assert.Equal(chest ? 190 : 180, g.Personal);
            Assert.Equal(250, g.Group);
            Assert.Equal(100, s.Rooms["maproom"]);
            Assert.Equal(150, s.Rooms["gearworks"]);
            Assert.Equal(chest ? 440 : 430, g.Personal + g.Group);
            Assert.Equal(s.Log.Count, s.Log.Select(e => e.Key).Distinct().Count());
            Assert.Equal(s.Log.Where(e => e.Kind == "personal").Sum(e => e.Points), g.Personal);
            Assert.DoesNotContain(s.Log, e => e.Type == "pickup");
            Assert.All(g.Ps, p => Assert.True(s.Personal.GetValueOrDefault(p.Id.ToString()) > 0));
            var result = g.E.BuildResult(g.R);
            Assert.Equal(result.PuzzlesTotal, result.PuzzlesSolved);
        }
    }

    [Fact]
    public void Hints_lower_only_the_room_group_points()
    {
        var g = InRoom2(2);
        Assert.True(g.E.RequestHint(g.R, g.Ps[0].Id, "g2-levers", T0).Ok);
        Assert.True(g.E.RequestHint(g.R, g.Ps[1].Id, "g2-levers", T0).Ok);
        Assert.False(g.E.RequestHint(g.R, g.Ps[1].Id, "g2-levers", T0).Ok);   // two hints per puzzle
        var personal = g.Personal;
        PlayRoom2(g.E, g.R, g.Ps, T0, readInscription: false);
        Assert.Equal(150 - 2 * 10, g.World.Score!.Rooms["gearworks"]);
        Assert.Equal(personal + 60, g.Personal);
    }

    [Fact]
    public void Repeating_room_two_actions_never_scores_twice()
    {
        var g = InRoom2(2);
        for (var i = 0; i < 3; i++) g.E.DiscoverClue(g.R, g.Ps[i % 2].Id, "g2-inscription", T0);
        Levers(g.E, g.R, g.Ps, T0);
        Assert.False(g.Op(0, "g2-levers", new { op = "pull", lever = "A" }).Ok);
        Rails(g.E, g.R, g.Ps, T0);
        Assert.False(g.Op(0, "g2-rails", new { op = "start" }).Ok);
        Gravity(g.E, g.R, g.Ps, T0);
        Assert.Equal("solved", g.Op(1, "g2-gate", new { op = "unlock", code = "5819" }, T0.AddSeconds(10)).Code);
        Assert.False(g.Op(0, "g2-gate", new { op = "unlock", code = "5819" }, T0.AddSeconds(11)).Ok);
        var s = g.World.Score!;
        Assert.Equal(s.Log.Count, s.Log.Select(e => e.Key).Distinct().Count());
        Assert.Equal(430, g.Personal + g.Group);
    }
}
