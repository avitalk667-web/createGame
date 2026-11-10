using System.Text.Json;
using PortalX.Server.Content;
using PortalX.Server.Domain;
using PortalX.Server.Game;
using static PortalX.Tests.GameEngineTests;
using Room1 = PortalX.Tests.GateOfSecretsRoom1Tests;
using Room2 = PortalX.Tests.GateOfSecretsRoom2Tests;

namespace PortalX.Tests;

/// <summary>
/// "שער הסודות", the end (stage D): the group's achievements and the personal titles, counted only from what the server
/// recorded; "solved X of 6"; and the other games keep their own results exactly as before.
/// </summary>
public class GateOfSecretsResultsTests
{
    private static readonly DateTime T0 = new(2026, 12, 14, 18, 0, 0, DateTimeKind.Utc);
    private static ScenarioContent Gate => Catalog.Get("gate-of-secrets");

    /// <summary>The whole game; the gate opens <paramref name="minutes"/> after the start.</summary>
    private static Room1.Game Play(int players, double minutes, Action<Room1.Game>? inRoom2 = null, string code = "RESULT")
    {
        var g = Room2.InRoom2(players, code);
        inRoom2?.Invoke(g);
        Room2.RunWater(g);
        Room2.Weigh(g);
        Assert.Equal("solved", g.Op(0, "g2-gate", new { op = "use" }, T0.AddMinutes(minutes)).Code);
        Assert.Equal(RoomPhase.Completed, g.R.Phase);
        return g;
    }

    private static HashSet<string> Earned(Room1.Game g) =>
        JsonSerializer.Deserialize<List<AchievementContent>>(g.E.BuildResult(g.R).AchievementsJson, ScenarioCatalog.JsonOptions)!.Select(a => a.Id).ToHashSet();

    [Fact]
    public void The_free_game_has_four_group_achievements_and_three_personal_titles()
    {
        Assert.Equal(["no-hints", "fast", "everyone", "precise"], Gate.Achievements.Select(a => a.Id).ToArray());
        Assert.Equal(["חד מחשבה", "חוקר מהיר", "עבודת צוות", "מדויק במיוחד"], Gate.Achievements.Select(a => a.Title).ToArray());
        Assert.Equal(["עין חדה", "פותח הדלתות", "אדון המנגנונים"], Gate.Titles.Select(t => t.Title).ToArray());
        Assert.All(Gate.Titles, t => Assert.Contains(t.Rule, GameEngine.TitleRules));
        Assert.Equal(10, Gate.FastMinutes);
        // the other games keep the general "fast" and their own lists
        Assert.Null(Catalog.Get("hanukkah-oil").FastMinutes);
        Assert.Null(Catalog.Get("stone-maze").FastMinutes);
        Assert.Empty(Catalog.Get("hanukkah-oil").Achievements);
    }

    [Fact]
    public void A_clean_quick_game_of_a_group_earns_all_four()
    {
        var g = Play(2, 9);
        var earned = Earned(g);
        Assert.Contains("no-hints", earned);
        Assert.Contains("fast", earned);
        Assert.Contains("everyone", earned);
        Assert.Contains("precise", earned);
        var r = g.E.BuildResult(g.R);
        Assert.Equal(6, r.PuzzlesTotal);
        Assert.Equal(6, r.PuzzlesSolved);
        Assert.Equal(0, r.HintsUsed);
        Assert.Equal(2, r.PlayersCount);
        Assert.Equal("success", r.CompletionType);
    }

    [Fact]
    public void Slow_hinted_and_error_full_games_do_not_earn_those_achievements()
    {
        var g = Play(1, 14, g =>
        {
            Assert.True(g.E.RequestHint(g.R, g.Ps[0].Id, "g2-pipes", T0.AddSeconds(3)).Ok);
            // three wrong flows (the pipes are not laid yet; the drain is shut first)
            g.Op(0, "g2-pipes", new { op = "valve", id = "drain" }, T0.AddSeconds(3));
            for (var i = 0; i < 3; i++) g.Op(0, "g2-pipes", new { op = "valve", id = "main" }, T0.AddSeconds(3));
            g.Op(0, "g2-pipes", new { op = "valve", id = "drain" }, T0.AddSeconds(3));   // open again, as RunWater expects
        });
        var earned = Earned(g);
        Assert.DoesNotContain("no-hints", earned);
        Assert.DoesNotContain("fast", earned);
        Assert.DoesNotContain("precise", earned);
        Assert.DoesNotContain("everyone", earned);   // alone: teamwork is for a group
        Assert.Equal(3, g.E.BuildResult(g.R).WrongAttempts);
    }

    [Fact]
    public void The_titles_count_only_recorded_events_and_never_the_key_in_the_gate()
    {
        var g = Play(1, 9);
        var titles = GameEngine.Titles(Gate, g.R, g.World);
        Assert.Equal(["sharp-eye", "door-opener", "mechanic"], titles.Select(t => t.Id).ToArray());
        Assert.All(titles, t => Assert.Equal([g.Ps[0].Id], t.Winners));
        // six puzzles helped, not seven: the golden key is the end, not a puzzle
        Assert.Equal(6, titles.First(t => t.Id == "door-opener").Count);
        // in a group the titles go to whoever did the most; a tie gives it to all of them
        var group = Play(4, 9, code: "RESGRP");
        var gt = GameEngine.Titles(Gate, group.R, group.World);
        Assert.All(gt, t => Assert.NotEmpty(t.Winners));
        var snapshotTitles = Snapshots.Build(group.E, group.R, null, T0.AddMinutes(10)).Score!.Titles!;
        Assert.Equal(3, snapshotTitles.Count);
    }

    /// <summary>A started game of <paramref name="scenario"/> that lasted <paramref name="minutes"/> (only the clock matters here).</summary>
    private static (GameEngine E, GameRoom R) Lasted(string scenario, double minutes)
    {
        var e = new GameEngine(Catalog, new GameOptions());
        var r = e.CreateRoom(scenario, "FAST" + scenario[..2].ToUpperInvariant(), "hash", T0);
        for (var i = 0; i < 2; i++)
        {
            Assert.True(e.AddPlayer(r, "שחקן" + i, GameEngine.Characters[i], "{}", "f" + i, i == 0, T0, out var p).Ok);
            p!.IsConnected = true;
            if (i > 0) e.SetReady(r, p.Id, true);
        }
        Assert.True(e.StartGame(r, r.Players.First(p => p.Seat == 0).Id, T0).Ok);
        r.StartedAt = T0;
        r.EndedAt = T0.AddMinutes(minutes);
        return (e, r);
    }

    private static bool Fast(string scenario, double minutes)
    {
        var (e, r) = Lasted(scenario, minutes);
        var raw = JsonSerializer.Deserialize<List<AchievementContent>>(e.BuildResult(r).AchievementsJson, ScenarioCatalog.JsonOptions)!;
        return raw.Any(a => a.Id == "fast");
    }

    [Fact]
    public void Only_the_free_game_uses_its_own_ten_minutes_for_fast_the_original_game_keeps_twenty_five()
    {
        // "הפורטל האחרון" lists "fast" too: it still uses the general 25 minutes
        Assert.True(Fast("last-portal", 20));
        Assert.True(Fast("last-portal", 24.5));
        Assert.False(Fast("last-portal", 26));
        // the free game: 10 minutes
        Assert.True(Fast("gate-of-secrets", 9.5));
        Assert.False(Fast("gate-of-secrets", 11));
        Assert.False(Fast("gate-of-secrets", 20));
        // the games without achievements stay without (nothing is shown for them)
        Assert.False(Fast("hanukkah-oil", 5));
        Assert.False(Fast("stone-maze", 5));
    }

    [Fact]
    public void The_hanukkah_game_keeps_its_results_unchanged()
    {
        // the general "fast" (25 minutes) and no achievements listed, as before
        var e = new GameEngine(Catalog, new GameOptions());
        var r = e.CreateRoom("hanukkah-oil", "HANRES", "hash", T0);
        Assert.True(e.AddPlayer(r, "שחקן", GameEngine.Characters[0], "{}", "h0", true, T0, out var p).Ok);
        p!.IsConnected = true;
        Assert.True(e.StartGame(r, p.Id, T0).Ok);
        Assert.Equal(25, new GameOptions().FastFinishMinutes);
        Assert.Equal(Catalog.Get("hanukkah-oil").Puzzles.Count(x => !x.Bonus), e.BuildResult(r).PuzzlesTotal);
        Assert.Equal("[]", e.BuildResult(r).AchievementsJson);
    }
}
