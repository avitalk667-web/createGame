using System.Text.Json;
using System.Text.Json.Nodes;
using PortalX.Server.Domain;
using PortalX.Server.Game;
using static PortalX.Tests.GameEngineTests;

namespace PortalX.Tests;

/// <summary>
/// "מבוך האבן", room 1 — the Stone Hall, puzzle 1: the crystal pendulum (three rounds — steady, varying, with a halt;
/// every stop judged on the server's clock, fair to slow phones) and the map assembled from the three pieces it frees.
/// (The tests of the earlier room 1 — testimonies, symbol board, letter cabinet — are kept in commit 0819a36.)
/// </summary>
public class StoneMazeRoom1Tests
{
    private static readonly DateTime T0 = new(2026, 12, 14, 18, 0, 0, DateTimeKind.Utc);
    private static JsonObject Data => Catalog.Get("stone-maze").Puzzle("g1-pendulum").PublicData;
    private static JsonNode Round(int i) => Data["rounds"]![i]!;

    // ------------------------------------------------------------------ helpers (also used by the room 2 tests)

    /// <summary>The first moment (seconds into the round, from 0.3 s) the swing is within <paramref name="deg"/> of the middle.</summary>
    public static double HitAt(JsonNode round, double deg = 1.0, double from = 0.3)
    {
        for (var t = from; t < 20; t += 0.001) if (Math.Abs(GameEngine.PendulumAngle(round, t)) <= deg) return t;
        throw new InvalidOperationException("the swing never passes the middle");
    }

    /// <summary>A moment the swing is between <paramref name="lo"/> and <paramref name="hi"/> degrees from the middle.</summary>
    public static double AngleAt(JsonNode round, double lo, double hi)
    {
        for (var t = 0.3; t < 20; t += 0.001) { var a = Math.Abs(GameEngine.PendulumAngle(round, t)); if (a >= lo && a <= hi) return t; }
        throw new InvalidOperationException("no such moment");
    }

    public static double Ms(DateTime t) => (t - DateTime.UnixEpoch).TotalMilliseconds;

    /// <summary>Presses "freeze" at <paramref name="pressed"/>; the message reaches the server <paramref name="lag"/> later.</summary>
    public static ActionOutcome Freeze(GameEngine e, GameRoom r, PlayerSession p, DateTime pressed, TimeSpan lag, double? rtt = null) =>
        e.Operate(r, p.Id, "g1-pendulum", J(rtt == null ? new { op = "freeze", at = Ms(pressed) } : (object)new { op = "freeze", at = Ms(pressed), rtt }), pressed + lag);

    /// <summary>
    /// Plays the Stone Hall as a group would: reads the entrance inscription, stops the pendulum in each of the three rounds
    /// (players taking turns, each message arriving 80 ms after the press), puts the map together, repeats the rune chain and
    /// opens the cabinet (the ancient key goes into the bag; the stone door is left to the caller).
    /// Returns the time reached.
    /// </summary>
    public static DateTime PlayRoom1(GameEngine e, GameRoom r, IList<PlayerSession> ps, DateTime t)
    {
        Assert.True(e.DiscoverClue(r, ps[0].Id, "g1-entrance", t).Ok);
        for (var round = 0; round < 3; round++)
        {
            var who = ps[(round + 1) % ps.Count];   // the reader of the inscription leaves the first stop to the next player
            Assert.True(e.Operate(r, who.Id, "g1-pendulum", J(new { op = "start" }), t).Ok);
            var pressed = t.AddSeconds(HitAt(Round(round)));
            var code = Freeze(e, r, who, pressed, TimeSpan.FromMilliseconds(80), 160).Code;
            Assert.Equal(round < 2 ? "hit" : "solved", code);
            t = pressed.AddSeconds(2);
        }
        // the pieces start in the order map-3, map-1, map-2; turned map-1: 1, map-2: 3, map-3: 2 quarter turns
        Assemble(e, r, ps, t);
        t = StoneMazeRunesTests.PlayRunes(e, r, ps, t.AddSeconds(2));
        OpenCabinet(e, r, ps, t);
        return t;
    }

    /// <summary>Puzzle 3: the wheels in the rune order (they start 2, 0, 3, 1 — compass 0, key 1, book 2, lamp 3), then 3142.</summary>
    public static void OpenCabinet(GameEngine e, GameRoom r, IList<PlayerSession> ps, DateTime t)
    {
        var turns = new[] { 2, 1, 3, 2 };
        for (var k = 0; k < 4; k++)
            for (var n = 0; n < turns[k]; n++)
                Assert.True(e.Operate(r, ps[(k + n) % ps.Count].Id, "g1-cabinet", J(new { op = "turn", wheel = k }), t).Ok);
        Assert.Equal("solved", e.Operate(r, ps[^1].Id, "g1-cabinet", J(new { op = "code", code = "3142" }), t).Code);
    }

    public static void Assemble(GameEngine e, GameRoom r, IList<PlayerSession> ps, DateTime t)
    {
        ActionOutcome Op(int who, object a) => e.Operate(r, ps[who % ps.Count].Id, "g1-map", J(a), t);
        Op(0, new { op = "swap", a = "map-3", b = "map-1" });   // map-1, map-3, map-2
        Op(1, new { op = "swap", a = "map-3", b = "map-2" });   // map-1, map-2, map-3
        Op(2, new { op = "rotate", piece = "map-1" });          // 1 → 2
        Op(2, new { op = "rotate", piece = "map-1" });          // 2 → 3
        Op(3, new { op = "rotate", piece = "map-1" });          // 3 → 0
        Op(0, new { op = "rotate", piece = "map-2" });          // 3 → 0
        Op(1, new { op = "rotate", piece = "map-3" });          // 2 → 3
        Assert.Equal("solved", Op(1, new { op = "rotate", piece = "map-3" }).Code); // 3 → 0
    }

    private sealed record Game(GameEngine E, GameRoom R, List<PlayerSession> Ps)
    {
        public ActionOutcome Op(int who, string puzzle, object action, DateTime at) => E.Operate(R, Ps[who % Ps.Count].Id, puzzle, J(action), at);
        public WorldState World => GameEngine.World(R);
        public MechanismState Pendulum => World.Mechanisms["g1-pendulum"];
        public PuzzleStatus Status(string id) => R.Puzzles.First(p => p.PuzzleId == id).Status;
    }

    private static Game Start(int players)
    {
        var e = new GameEngine(Catalog, new GameOptions());
        var r = e.CreateRoom("stone-maze", "HALL" + players + "X", "hash", T0);
        var ps = new List<PlayerSession>();
        for (var i = 0; i < players; i++)
        {
            Assert.True(e.AddPlayer(r, "שחקן" + i, GameEngine.Characters[i], "{}", "h" + i, i == 0, T0, out var p).Ok);
            p!.IsConnected = true;
            ps.Add(p);
        }
        for (var i = 1; i < players; i++) e.SetReady(r, ps[i].Id, true);
        Assert.True(e.StartGame(r, ps[0].Id, T0).Ok);
        Assert.True(e.FinishIntro(r, ps[0].Id, true, T0).Ok);
        return new Game(e, r, ps);
    }

    // ------------------------------------------------------------------ the swing itself

    [Fact]
    public void Each_round_swings_within_its_amplitude_and_passes_the_middle_again_and_again()
    {
        for (var i = 0; i < 3; i++)
        {
            var round = Round(i);
            var amp = round["amplitude"]!.GetValue<double>();
            var crossings = 0;
            var prev = GameEngine.PendulumAngle(round, 0.001);
            for (var t = 0.002; t < 12; t += 0.002)
            {
                var a = GameEngine.PendulumAngle(round, t);
                Assert.InRange(a, -amp - 1e-9, amp + 1e-9);
                if (Math.Sign(a) != Math.Sign(prev) && prev != 0) crossings++;
                prev = a;
            }
            Assert.True(crossings >= 7, $"round {i + 1}: only {crossings} passes in 12 s");
        }
    }

    [Fact]
    public void The_second_round_changes_pace_and_the_third_halts_for_a_moment_on_its_way_down()
    {
        // round 2: the time between passes through the middle is not constant
        var r2 = Round(1);
        var passes = new List<double>();
        var prev = GameEngine.PendulumAngle(r2, 0.001);
        for (var t = 0.002; t < 15; t += 0.001)
        {
            var a = GameEngine.PendulumAngle(r2, t);
            if (Math.Sign(a) != Math.Sign(prev)) passes.Add(t);
            prev = a;
        }
        var gaps = passes.Zip(passes.Skip(1), (x, y) => y - x).ToList();
        Assert.True(gaps.Max() - gaps.Min() > 0.25, "the pace should drift noticeably");

        // round 3: for half a second each swing the angle stays put — away from the target zone
        var r3 = Round(2);
        var period = r3["period"]!.GetValue<double>();
        var at = r3["pauseAt"]!.GetValue<double>() * period;
        var held = GameEngine.PendulumAngle(r3, at + 0.01);
        Assert.Equal(held, GameEngine.PendulumAngle(r3, at + 0.4), 6);
        Assert.True(Math.Abs(held) > Data["widenedWindow"]!.GetValue<double>(), "the halt must be outside even the widened zone");
    }

    // ------------------------------------------------------------------ the rules of the stops

    [Fact]
    public void The_pendulum_must_be_started_and_each_round_needs_one_stop_in_the_zone()
    {
        var g = Start(1);
        var p = g.Ps[0];
        Assert.Equal("not-running", Freeze(g.E, g.R, p, T0, TimeSpan.Zero).Code);
        Assert.Equal(PuzzleStatus.Locked, g.Status("g1-map")); // the map waits for the pendulum
        Assert.Equal("started", g.Op(0, "g1-pendulum", new { op = "start" }, T0).Code);
        Assert.Equal("running", g.Op(0, "g1-pendulum", new { op = "start" }, T0.AddSeconds(1)).Code); // a second start changes nothing
        Assert.Equal(T0, g.Pendulum.StartedAt);

        // far from the middle: a miss, the swing goes on
        var off = T0.AddSeconds(AngleAt(Round(0), 25, 34));
        var miss = Freeze(g.E, g.R, p, off, TimeSpan.Zero);
        Assert.Equal("missed", miss.Code);
        Assert.True(g.Pendulum.Running);
        Assert.Equal(0, g.Pendulum.Progress);
        Assert.Equal(1, g.Pendulum.Misses);

        // in the middle: a hit — the swing stops, a piece is freed, the next round waits for "start"
        var hit = Freeze(g.E, g.R, p, T0.AddSeconds(HitAt(Round(0))), TimeSpan.Zero);
        Assert.Equal("hit", hit.Code);
        Assert.Equal("map-1", hit.Data!["piece"]!.GetValue<string>());
        Assert.False(g.Pendulum.Running);
        Assert.Equal(1, g.Pendulum.Progress);
        Assert.Equal("not-running", Freeze(g.E, g.R, p, T0.AddSeconds(5), TimeSpan.Zero).Code);
    }

    [Fact]
    public void A_miss_says_whether_it_was_early_or_late()
    {
        var g = Start(1);
        g.Op(0, "g1-pendulum", new { op = "start" }, T0);
        var round = Round(0);
        var mid = HitAt(round);
        // 0.3 s before the middle the swing is still coming; 0.3 s after it is moving away
        Assert.StartsWith("מוקדם מדי", Freeze(g.E, g.R, g.Ps[0], T0.AddSeconds(mid - 0.3), TimeSpan.Zero).Message);
        Assert.StartsWith("מאוחר מדי", Freeze(g.E, g.R, g.Ps[0], T0.AddSeconds(mid + 0.3), TimeSpan.Zero).Message);
    }

    [Fact]
    public void After_three_misses_the_target_zone_widens_and_misses_cost_no_points()
    {
        var g = Start(1);
        g.Op(0, "g1-pendulum", new { op = "start" }, T0);
        var round = Round(0);
        // a moment 9° from the middle: outside the normal zone (7°), inside the widened one (12°)
        var nine = T0.AddSeconds(AngleAt(round, 8.8, 9.2));
        Assert.Equal("missed", Freeze(g.E, g.R, g.Ps[0], nine, TimeSpan.Zero).Code);
        Assert.Equal("missed", Freeze(g.E, g.R, g.Ps[0], nine, TimeSpan.Zero).Code);
        var third = Freeze(g.E, g.R, g.Ps[0], nine, TimeSpan.Zero);
        Assert.Equal("missed", third.Code);
        Assert.True(third.Data!["widened"]!.GetValue<bool>());
        Assert.Contains("האזור המסומן התרחב", third.Message);
        Assert.Equal("hit", Freeze(g.E, g.R, g.Ps[0], nine, TimeSpan.Zero).Code);
        Assert.DoesNotContain(g.World.Score?.Log ?? [], e => e.Points < 0);
        Assert.Equal(0, g.R.Puzzles.First(p => p.PuzzleId == "g1-pendulum").WrongStreak);
    }

    // ------------------------------------------------------------------ fairness on slow connections

    [Theory]
    [InlineData(0)]
    [InlineData(100)]
    [InlineData(250)]
    [InlineData(450)]
    public void A_press_is_judged_by_when_the_player_pressed_not_when_the_message_arrived(int oneWayMs)
    {
        // the same presses, sent over a fast and a slow connection, must get the same verdicts
        foreach (var round in new[] { 0, 1, 2 })
        {
            var mid = HitAt(Round(round));
            for (var offset = -0.40; offset <= 0.40; offset += 0.02)
            {
                var g = Start(1);
                // reach the round being tested
                for (var k = 0; k < round; k++)
                {
                    g.Op(0, "g1-pendulum", new { op = "start" }, T0);
                    Assert.Equal("hit", Freeze(g.E, g.R, g.Ps[0], T0.AddSeconds(HitAt(Round(k))), TimeSpan.Zero).Code);
                }
                g.Op(0, "g1-pendulum", new { op = "start" }, T0);
                var pressed = T0.AddSeconds(mid + offset);
                var expected = Math.Abs(GameEngine.PendulumAngle(Round(round), mid + offset)) <= Data["window"]!.GetValue<double>();
                var outcome = Freeze(g.E, g.R, g.Ps[0], pressed, TimeSpan.FromMilliseconds(oneWayMs), rtt: 2 * oneWayMs);
                Assert.True(expected == (outcome.Code is "hit" or "solved"),
                    $"round {round + 1}, {offset:+0.00;-0.00} s from the middle, {oneWayMs} ms away: {outcome.Code}");
            }
        }
    }

    [Fact]
    public void Without_the_correction_a_slow_phone_would_be_late_and_with_it_the_same_press_hits()
    {
        var g = Start(2);
        g.Op(0, "g1-pendulum", new { op = "start" }, T0);
        var pressed = T0.AddSeconds(HitAt(Round(0)));
        var arrives = TimeSpan.FromMilliseconds(400);
        // judged on arrival (what an engine without the correction would do), the stop is far outside the zone
        Assert.True(Math.Abs(GameEngine.PendulumAngle(Round(0), (pressed + arrives - T0).TotalSeconds)) > Data["window"]!.GetValue<double>());
        // the browser says when it was pressed and how slow the connection is: a hit
        Assert.Equal("hit", Freeze(g.E, g.R, g.Ps[1], pressed, arrives, rtt: 800).Code);
    }

    [Fact]
    public void Nobody_can_claim_a_moment_long_gone_or_still_to_come()
    {
        var data = Data;
        var now = T0.AddSeconds(10);
        // a moment 2 s ago with a fast connection: counted as 150 + 50 = 200 ms ago at most
        Assert.Equal(now.AddMilliseconds(-200), GameEngine.PendulumPressTime(data, J(new { op = "freeze", at = Ms(now.AddSeconds(-2)), rtt = 100 }), now));
        // a claimed huge round trip changes nothing beyond the limit (600 ms)
        Assert.Equal(now.AddMilliseconds(-600), GameEngine.PendulumPressTime(data, J(new { op = "freeze", at = Ms(now.AddSeconds(-2)), rtt = 99999 }), now));
        // a moment in the future: counted as now
        Assert.Equal(now, GameEngine.PendulumPressTime(data, J(new { op = "freeze", at = Ms(now.AddSeconds(1)), rtt = 100 }), now));
        // no moment at all: a short margin before arrival
        Assert.Equal(now.AddMilliseconds(-150), GameEngine.PendulumPressTime(data, J(new { op = "freeze" }), now));
    }

    [Fact]
    public void Two_players_pressing_together_stop_the_swing_once()
    {
        var g = Start(4);
        g.Op(0, "g1-pendulum", new { op = "start" }, T0);
        var pressed = T0.AddSeconds(HitAt(Round(0)));
        Assert.Equal("hit", Freeze(g.E, g.R, g.Ps[1], pressed, TimeSpan.FromMilliseconds(60), 120).Code);
        Assert.Equal("not-running", Freeze(g.E, g.R, g.Ps[2], pressed, TimeSpan.FromMilliseconds(90), 180).Code);
        Assert.Equal(1, g.Pendulum.Progress);
    }

    // ------------------------------------------------------------------ the map

    [Fact]
    public void The_map_is_whole_only_with_every_piece_in_place_and_upright()
    {
        var g = Start(2);
        for (var round = 0; round < 3; round++)
        {
            g.Op(0, "g1-pendulum", new { op = "start" }, T0);
            Freeze(g.E, g.R, g.Ps[round % 2], T0.AddSeconds(HitAt(Round(round))), TimeSpan.Zero);
        }
        Assert.Equal(PuzzleStatus.Solved, g.Status("g1-pendulum"));
        Assert.Equal(PuzzleStatus.Active, g.Status("g1-map"));
        var map = () => g.World.Mechanisms["g1-map"];
        Assert.Equal("bad-piece", g.Op(0, "g1-map", new { op = "rotate", piece = "nothing" }, T0).Code);
        // nothing has been touched yet: the pieces lie as they fell (map-3, map-1, map-2; map-1 turned 1, map-2 3, map-3 2)
        g.Op(0, "g1-map", new { op = "swap", a = "map-3", b = "map-1" }, T0);
        g.Op(0, "g1-map", new { op = "swap", a = "map-3", b = "map-2" }, T0);
        Assert.Equal(["map-1", "map-2", "map-3"], new[] { map().Slots["p1"], map().Slots["p2"], map().Slots["p3"] });
        Assert.Equal(PuzzleStatus.Active, g.Status("g1-map")); // right order, still turned
        foreach (var (piece, turns) in new[] { ("map-1", 3), ("map-2", 1) })
            for (var k = 0; k < turns; k++) g.Op(1, "g1-map", new { op = "rotate", piece }, T0);
        g.Op(1, "g1-map", new { op = "rotate", piece = "map-3" }, T0);
        Assert.Equal(PuzzleStatus.Active, g.Status("g1-map")); // one piece still turned
        Assert.Equal("solved", g.Op(0, "g1-map", new { op = "rotate", piece = "map-3" }, T0).Code);
        Assert.False(g.Op(0, "g1-map", new { op = "rotate", piece = "map-3" }, T0).Ok); // solved stays solved
    }

    [Fact]
    public void The_solution_of_the_map_never_reaches_the_browser()
    {
        var publicJson = Snapshots.PublicScenario(Catalog.Get("stone-maze")).ToJsonString();
        var map = Catalog.Get("stone-maze").Puzzle("g1-map");
        Assert.DoesNotContain("\"order\":[\"map-1\",\"map-2\",\"map-3\"]", publicJson);
        Assert.Contains("map-1", map.Solution.ToJsonString());
    }

    // ------------------------------------------------------------------ the whole room with 1, 2 and 4 players

    [Theory]
    [InlineData(1)]
    [InlineData(2)]
    [InlineData(4)]
    public void The_stone_hall_is_played_through_by_any_group_and_scores_each_award_once(int players)
    {
        var g = Start(players);
        PlayRoom1(g.E, g.R, g.Ps, T0);
        Assert.Equal(PuzzleStatus.Solved, g.Status("g1-map"));
        Assert.Equal(PuzzleStatus.Solved, g.Status("g1-runes"));
        Assert.Null(g.World.PendingZone);                           // only the stone door opens the next room
        var s = g.World.Score!;
        // room 1:
        // inscription 5 + three stops 3×5 + pendulum 20 + map 20 + three rune stages 3×5 + runes 20 + cabinet 20 = 115
        Assert.Equal(115, s.Personal.Values.Sum());
        Assert.Equal(3, s.Log.Count(e => e.Type == "stage" && e.PuzzleId == "g1-runes"));
        Assert.Equal(3, s.Log.Count(e => e.Type == "stage" && e.PuzzleId == "g1-pendulum"));
        Assert.False(s.Rooms.ContainsKey("maproom"));               // the room's group points come with its door
        Assert.Equal(s.Log.Count, s.Log.Select(e => e.Key).Distinct().Count());
        // repeating everything adds nothing
        Assert.False(g.Op(0, "g1-pendulum", new { op = "start" }, T0.AddMinutes(1)).Ok);
        g.E.DiscoverClue(g.R, g.Ps[0].Id, "g1-entrance", T0.AddMinutes(1));
        Assert.Equal(115, g.World.Score!.Personal.Values.Sum());
        StoneMazeDoorTests.ThroughTheStoneDoor(g.E, g.R, g.Ps, T0.AddMinutes(1));
        Assert.Equal("gearworks", g.World.CurrentZone);
        Assert.Equal(100, g.World.Score!.Rooms["maproom"]);
    }

    [Fact]
    public void The_swing_survives_a_reconnect_everyone_sees_the_same_start()
    {
        var g = Start(2);
        g.Op(0, "g1-pendulum", new { op = "start" }, T0);
        g.R.Players.First(p => p.Id == g.Ps[1].Id).IsConnected = false;
        Assert.True(g.E.Reconnect(g.R, g.Ps[1].Id, "conn-2", T0.AddSeconds(3)).Ok);
        var snap = Snapshots.Build(g.E, g.R, null, T0.AddSeconds(3));
        var mech = snap.Mechanisms!["g1-pendulum"]!;
        Assert.True(mech["running"]!.GetValue<bool>());
        Assert.Equal(T0, mech["startedAt"]!.GetValue<DateTime>());
        Assert.Equal(T0.AddSeconds(3), snap.ServerNow); // the browser draws the swing from startedAt on the server's clock
        // the player who came back can stop it
        Assert.Equal("hit", Freeze(g.E, g.R, g.Ps[1], T0.AddSeconds(HitAt(Round(0), 1.0, 3.2)), TimeSpan.FromMilliseconds(50), 100).Code);
    }
}
