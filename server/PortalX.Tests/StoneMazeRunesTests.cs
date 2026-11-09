using System.Text.Json;
using System.Text.Json.Nodes;
using PortalX.Server.Domain;
using PortalX.Server.Game;
using static PortalX.Tests.GameEngineTests;

namespace PortalX.Tests;

/// <summary>
/// "מבוך האבן", the Stone Hall, puzzle 2 — the rune chain: the disc lights its symbols in an order and the group
/// repeats it on the rune stones. Three stages (2, 3, 4 symbols); in the second one light comes "in the dark" and only one
/// player holds it as a private clue (all of it when alone; shared with the rest if they are away).
/// </summary>
public class StoneMazeRunesTests
{
    private static readonly DateTime T0 = new(2026, 12, 14, 18, 0, 0, DateTimeKind.Utc);
    private static readonly string[][] Stages = [["lamp", "book"], ["key", "compass", "lamp"], ["compass", "key", "book", "lamp"]];
    private static JsonObject Data => Catalog.Get("stone-maze").Puzzle("g1-runes").PublicData;

    /// <summary>The moment the lights of a stage that started at <paramref name="started"/> are over (and a press counts).</summary>
    private static DateTime AfterShow(DateTime started, int stage, int misses = 0) =>
        GameEngine.SequenceShowEnd(Data, started, Stages[stage].Length, misses, Data["stages"]![stage]!["dark"] != null).AddMilliseconds(100);

    /// <summary>Plays the rune chain from its start: shows the first stage, then repeats every stage (players taking turns).</summary>
    public static DateTime PlayRunes(GameEngine e, GameRoom r, IList<PlayerSession> ps, DateTime t)
    {
        ActionOutcome Op(int who, object a, DateTime at) => e.Operate(r, ps[who % ps.Count].Id, "g1-runes", J(a), at);
        Assert.Equal("showing", Op(0, new { op = "show" }, t).Code);
        var started = t;
        for (var stage = 0; stage < 3; stage++)
        {
            var at = AfterShow(started, stage);
            string code = "";
            for (var k = 0; k < Stages[stage].Length; k++)
                code = Op(stage + k, new { op = "press", symbol = Stages[stage][k] }, at.AddMilliseconds(300 * k)).Code;
            Assert.Equal(stage < 2 ? "stage" : "solved", code);
            started = GameEngine.World(r).Mechanisms["g1-runes"].StartedAt ?? at;
            t = at.AddSeconds(2);
        }
        return t;
    }

    private sealed record Game(GameEngine E, GameRoom R, List<PlayerSession> Ps)
    {
        public ActionOutcome Op(int who, object action, DateTime at) => E.Operate(R, Ps[who % Ps.Count].Id, "g1-runes", J(action), at);
        public MechanismState Mech => GameEngine.World(R).Mechanisms["g1-runes"];
        public PuzzleStatus Status(string id) => R.Puzzles.First(p => p.PuzzleId == id).Status;
        public WorldState World => GameEngine.World(R);
    }

    /// <summary>A group in the Stone Hall with the pendulum and the map already done (the rune chain is next).</summary>
    private static Game AtRunes(int players)
    {
        var e = new GameEngine(Catalog, new GameOptions());
        var r = e.CreateRoom("stone-maze", "RUNE" + players + "X", "hash", T0);
        var ps = new List<PlayerSession>();
        for (var i = 0; i < players; i++)
        {
            Assert.True(e.AddPlayer(r, "שחקן" + i, GameEngine.Characters[i], "{}", "r" + i, i == 0, T0, out var p).Ok);
            p!.IsConnected = true;
            ps.Add(p);
        }
        for (var i = 1; i < players; i++) e.SetReady(r, ps[i].Id, true);
        Assert.True(e.StartGame(r, ps[0].Id, T0).Ok);
        Assert.True(e.FinishIntro(r, ps[0].Id, true, T0).Ok);
        var g = new Game(e, r, ps);
        Assert.Equal(PuzzleStatus.Locked, g.Status("g1-runes"));   // the disc waits for the map
        for (var round = 0; round < 3; round++)
        {
            Assert.True(e.Operate(r, ps[0].Id, "g1-pendulum", J(new { op = "start" }), T0).Ok);
            StoneMazeRoom1Tests.Freeze(e, r, ps[0], T0.AddSeconds(StoneMazeRoom1Tests.HitAt(Catalog.Get("stone-maze").Puzzle("g1-pendulum").PublicData["rounds"]![round]!)), TimeSpan.Zero);
        }
        StoneMazeRoom1Tests.Assemble(e, r, ps, T0);
        Assert.Equal(PuzzleStatus.Active, g.Status("g1-runes"));
        Assert.Null(g.World.PendingZone);                          // the map no longer opens the door: the runes do
        return g;
    }

    // ------------------------------------------------------------------ the sequence and its rules

    [Fact]
    public void The_order_on_the_disc_and_on_the_stones_is_not_the_order_of_the_answer()
    {
        var data = Data;
        var answer = Stages[2];
        Assert.NotEqual(answer, data["stones"]!.AsArray().Select(n => n!.GetValue<string>()).ToArray());
        // the stones hold each symbol once
        Assert.Equal(answer.OrderBy(x => x), data["stones"]!.AsArray().Select(n => n!.GetValue<string>()).OrderBy(x => x));
    }

    [Fact]
    public void A_press_counts_only_after_the_lights_have_been_shown()
    {
        var g = AtRunes(1);
        Assert.Equal("not-shown", g.Op(0, new { op = "press", symbol = "lamp" }, T0).Code);
        Assert.Equal("showing", g.Op(0, new { op = "show" }, T0).Code);
        Assert.Equal(["lamp", "book"], g.Mech.Shown);
        Assert.Equal("showing", g.Op(0, new { op = "press", symbol = "lamp" }, T0.AddSeconds(1)).Code);   // still lighting up
        Assert.Equal("showing", g.Op(0, new { op = "show" }, T0.AddSeconds(1)).Code);                     // no replay over it
        var at = AfterShow(T0, 0);
        Assert.Equal("pressed", g.Op(0, new { op = "press", symbol = "lamp" }, at).Code);
        Assert.Equal("stage", g.Op(0, new { op = "press", symbol = "book" }, at).Code);
        Assert.Equal(1, g.Mech.Progress);
        // the next stage plays by itself a moment later — with its dark light hidden from the public state
        Assert.True(g.Mech.StartedAt > at);
        Assert.Equal(["key", "?", "lamp"], g.Mech.Shown);
    }

    [Fact]
    public void A_wrong_symbol_resets_the_attempt_and_three_mistakes_slow_the_lights_down()
    {
        var g = AtRunes(2);
        g.Op(0, new { op = "show" }, T0);
        var at = AfterShow(T0, 0);
        Assert.Equal("pressed", g.Op(0, new { op = "press", symbol = "lamp" }, at).Code);
        var wrong = g.Op(1, new { op = "press", symbol = "key" }, at);
        Assert.Equal("wrong", wrong.Code);
        Assert.Contains("התאפס", wrong.Message);
        Assert.Empty(g.Mech.Input!);
        Assert.Equal(0, g.Mech.Progress);   // the stage stays, only the attempt starts over
        g.Op(0, new { op = "press", symbol = "book" }, at);
        var third = g.Op(0, new { op = "press", symbol = "compass" }, at);
        Assert.Equal(3, g.Mech.Misses);
        Assert.Contains("לאט יותר", third.Message);
        // the replay is slower now
        var step = GameEngine.SequenceStep(Data, 3);
        Assert.True(step > GameEngine.SequenceStep(Data, 0));
        var replayAt = AfterShow(T0, 0).AddSeconds(5);
        Assert.Equal("showing", g.Op(1, new { op = "show" }, replayAt).Code);
        Assert.Equal("showing", g.Op(1, new { op = "press", symbol = "lamp" }, AfterShow(replayAt, 0, 0)).Code);   // the slower show is still on
        Assert.Equal("pressed", g.Op(1, new { op = "press", symbol = "lamp" }, AfterShow(replayAt, 0, 3)).Code);
        // mistakes cost no points
        Assert.DoesNotContain(g.World.Score?.Log ?? [], e => e.Points < 0);
    }

    [Fact]
    public void The_whole_chain_lights_the_stones_but_opens_no_door_and_gives_no_key()
    {
        var g = AtRunes(1);
        PlayRunes(g.E, g.R, g.Ps, T0);
        Assert.Equal(PuzzleStatus.Solved, g.Status("g1-runes"));
        Assert.Equal(Stages[2], g.Mech.Input);
        Assert.Null(g.World.PendingZone);                    // the door at the end of the room does that
        Assert.DoesNotContain("gs-golden-key", g.World.Inventory);   // the key will come from the cabinet
        Assert.False(g.Op(0, new { op = "show" }, T0.AddMinutes(1)).Ok);   // solved stays solved
    }

    // ------------------------------------------------------------------ the light in the dark: one player's private clue

    [Theory]
    [InlineData(1, 0)]
    [InlineData(2, 1)]
    [InlineData(3, 1)]
    [InlineData(4, 1)]
    public void Exactly_one_player_holds_the_light_in_the_dark(int players, int holder)
    {
        var g = AtRunes(players);
        for (var i = 0; i < players; i++)
        {
            var clues = g.E.GetPersonalClues(g.R, g.Ps[i].Id, "g1-runes", T0).Data!["clues"]!.AsArray();
            if (i == holder) Assert.Contains("המצפן", clues.Single()!["text"]!.GetValue<string>());
            else Assert.Empty(clues);
        }
    }

    [Fact]
    public void The_light_in_the_dark_stays_on_longer_so_its_symbol_can_be_seen()
    {
        var g = AtRunes(1);
        g.Op(0, new { op = "show" }, T0);
        var at = AfterShow(T0, 0);
        g.Op(0, new { op = "press", symbol = "lamp" }, at);
        g.Op(0, new { op = "press", symbol = "book" }, at);
        var started = g.Mech.StartedAt!.Value;
        var hold = Data["darkHoldSeconds"]!.GetValue<double>();
        Assert.True(hold >= 1.5);
        // the stage of three without the hold would be over here — with it, the lights are still on
        var plainEnd = GameEngine.SequenceShowEnd(Data, started, 3, 0).AddMilliseconds(100);
        Assert.Equal("showing", g.Op(0, new { op = "press", symbol = "key" }, plainEnd).Code);
        Assert.Equal("pressed", g.Op(0, new { op = "press", symbol = "key" }, AfterShow(started, 1)).Code);
    }

    [Theory]
    [InlineData(1)]
    [InlineData(2)]
    public void Alone_the_player_is_told_to_remember_the_light_with_others_to_share_it(int players)
    {
        var g = AtRunes(players);
        g.Op(0, new { op = "show" }, T0);
        var at = AfterShow(T0, 0);
        g.Op(0, new { op = "press", symbol = "lamp" }, at);
        var stage = g.Op(0, new { op = "press", symbol = "book" }, at);
        var dark = stage.Notices.Single(n => n.Kind == "sequence-dark").Message;
        if (players == 1) { Assert.Contains("זכרו את הסמל", dark); Assert.DoesNotContain("שתפו", dark); Assert.DoesNotContain("אחד מכם", dark); }
        else Assert.Contains("רק אחד מכם", dark);
        Assert.DoesNotContain("מצפן", dark);   // the public notice never names the symbol
        // the player alone finishes the stage with the light in the dark by themselves
        if (players == 1)
        {
            var at2 = AfterShow(g.Mech.StartedAt!.Value, 1);
            foreach (var s in Stages[1]) g.Op(0, new { op = "press", symbol = s }, at2);
            Assert.Equal(2, g.Mech.Progress);
        }
    }

    [Fact]
    public void The_light_in_the_dark_never_reaches_the_public_state()
    {
        var g = AtRunes(2);
        g.Op(0, new { op = "show" }, T0);
        var at = AfterShow(T0, 0);
        g.Op(0, new { op = "press", symbol = "lamp" }, at);
        g.Op(0, new { op = "press", symbol = "book" }, at);
        var snap = JsonSerializer.Serialize(Snapshots.Build(g.E, g.R, null, at));
        var scenario = Snapshots.PublicScenario(Catalog.Get("stone-maze")).ToJsonString();
        Assert.Contains("\"?\"", snap);
        Assert.DoesNotContain("\"key\",\"compass\",\"lamp\"", snap);
        Assert.DoesNotContain("\"stages\":[[", scenario);   // the answers stay on the server
        Assert.DoesNotContain("היה המצפן", scenario);
    }

    [Fact]
    public void A_holder_away_for_a_minute_leaves_the_clue_with_the_others_and_gets_it_back_on_return()
    {
        var g = AtRunes(3);
        var holder = g.Ps[1];
        holder.IsConnected = false;
        holder.DisconnectedAt = T0;
        // before a minute: still private
        Assert.Empty(g.E.GetPersonalClues(g.R, g.Ps[0].Id, "g1-runes", T0.AddSeconds(30)).Data!["clues"]!.AsArray());
        // after a minute the others see it, with the holder's name
        var shared = g.E.GetPersonalClues(g.R, g.Ps[0].Id, "g1-runes", T0.AddSeconds(61)).Data!["clues"]!.AsArray().Single()!;
        Assert.True(shared["away"]!.GetValue<bool>());
        Assert.Equal(holder.Nickname, shared["from"]!.GetValue<string>());
        // the holder comes back and has it as their own
        Assert.True(g.E.Reconnect(g.R, holder.Id, "back", T0.AddSeconds(90)).Ok);
        Assert.Single(g.E.GetPersonalClues(g.R, holder.Id, "g1-runes", T0.AddSeconds(90)).Data!["clues"]!.AsArray());
        Assert.Empty(g.E.GetPersonalClues(g.R, g.Ps[0].Id, "g1-runes", T0.AddSeconds(90)).Data!["clues"]!.AsArray());
    }

    [Fact]
    public void Repeating_the_chain_never_scores_twice_and_each_stage_counts_for_whoever_finished_it()
    {
        var g = AtRunes(4);
        var before = g.World.Score!.Personal.Values.Sum();
        PlayRunes(g.E, g.R, g.Ps, T0);
        var s = g.World.Score!;
        Assert.Equal(before + 3 * 5 + 20, s.Personal.Values.Sum());
        Assert.Equal(3, s.Log.Count(e => e.Type == "stage" && e.PuzzleId == "g1-runes"));
        Assert.Equal(s.Log.Count, s.Log.Select(e => e.Key).Distinct().Count());
        g.Op(2, new { op = "press", symbol = "compass" }, T0.AddMinutes(2));
        Assert.Equal(before + 35, g.World.Score!.Personal.Values.Sum());
    }
}
