using System.Text.Json;
using PortalX.Server.Content;
using PortalX.Server.Domain;
using PortalX.Server.Game;
using static PortalX.Tests.GameEngineTests;

namespace PortalX.Tests;

/// <summary>The four end-of-game titles: counted from verified events only, shared on a tie, given to nobody without events.</summary>
public class PersonalTitleTests
{
    private static readonly DateTime T0 = new(2026, 12, 14, 18, 0, 0, DateTimeKind.Utc);
    private static ScenarioContent Content => Catalog.Get("hanukkah-oil");

    private static (GameEngine e, GameRoom r, List<PlayerSession> ps) Start(int players)
    {
        var e = new GameEngine(Catalog, new GameOptions());
        var r = e.CreateRoom("hanukkah-oil", "TTL234", "hash", T0);
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

    private static TitleDto Title(GameRoom r, string id) => GameEngine.Titles(Content, r, GameEngine.World(r)).Single(t => t.Id == id);
    private static void Examine(GameEngine e, GameRoom r, PlayerSession p, string target)
    {
        e.Operate(r, p.Id, "h1-evidence", J(new { op = "inspect", target }), T0);
        e.Operate(r, p.Id, "h1-evidence", J(new { op = "reveal", target }), T0);
    }

    [Fact]
    public void The_scenario_defines_the_four_titles()
    {
        Assert.Equal(["בלש האחוזה", "מפענח הסודות", "יד הזהב", "מאיר הדרך"], Content.Titles.Select(t => t.Title));
        Assert.Equal(["discoveries", "puzzles", "mechanisms", "hintless"], Content.Titles.Select(t => t.Rule));
    }

    [Fact]
    public void Before_any_event_no_title_has_a_winner()
    {
        var (_, r, _) = Start(3);
        Assert.All(GameEngine.Titles(Content, r, GameEngine.World(r)), t => { Assert.Empty(t.Winners); Assert.Equal(0, t.Count); });
    }

    [Fact]
    public void Titles_follow_the_verified_events_and_a_tie_gives_several_winners()
    {
        var (e, r, ps) = Start(2);
        Examine(e, r, ps[0], "book");
        // examining the same object again adds nothing
        Examine(e, r, ps[0], "book");
        Examine(e, r, ps[0], "book");
        Examine(e, r, ps[0], "hourglass");
        Examine(e, r, ps[1], "lamp");
        Examine(e, r, ps[1], "scroll");   // the last object solves the evidence puzzle
        Assert.Equal(PuzzleStatus.Solved, r.Puzzles.First(p => p.PuzzleId == "h1-evidence").Status);

        var detective = Title(r, "detective");
        Assert.Equal(4, detective.Count);                      // two objects and two symbols each
        Assert.Equal([ps[0].Id, ps[1].Id], detective.Winners);
        Assert.Equal([ps[1].Id], Title(r, "golden-hand").Winners);   // only the solve of the mechanism counts, not looking
        Assert.Equal(2, Title(r, "decoder").Winners.Count);           // both helped solve it
        Assert.Equal(2, Title(r, "lightbringer").Winners.Count);

        // the board with a hint: player 0 solves it alone
        Assert.True(e.RequestHint(r, ps[0].Id, "h1-board", T0).Ok);
        foreach (var (slot, item) in LibraryChain.Board) e.Operate(r, ps[0].Id, "h1-board", J(new { op = "place", slot, item }), T0);
        Assert.Equal(PuzzleStatus.Solved, r.Puzzles.First(p => p.PuzzleId == "h1-board").Status);

        Assert.Equal([ps[0].Id], Title(r, "decoder").Winners);
        Assert.Equal(2, Title(r, "decoder").Count);
        Assert.Equal([ps[0].Id, ps[1].Id], Title(r, "golden-hand").Winners);
        // the board took a hint, so the hintless count stays one each
        var light = Title(r, "lightbringer");
        Assert.Equal(1, light.Count);
        Assert.Equal(2, light.Winners.Count);
    }

    [Fact]
    public void A_single_player_takes_every_title_they_earned()
    {
        var (e, r, ps) = Start(1);
        LibraryChain.Open(e, r, ps[0].Id, T0);
        Assert.All(GameEngine.Titles(Content, r, GameEngine.World(r)), t => Assert.Equal([ps[0].Id], t.Winners));
    }

    [Fact]
    public void The_shared_state_carries_the_titles_only_once_the_game_has_ended()
    {
        var (e, r, ps) = Start(2);
        LibraryChain.Open(e, r, ps[0].Id, T0);
        Assert.Null(Snapshots.Build(e, r, null, T0).Score!.Titles);
        r.Phase = RoomPhase.Completed;
        var titles = Snapshots.Build(e, r, null, T0).Score!.Titles!;
        Assert.Equal(4, titles.Count);
        Assert.Contains("בלש האחוזה", JsonSerializer.Serialize(titles, ScenarioCatalog.JsonOptions));
    }

    [Fact]
    public void A_scenario_without_titles_gives_none()
    {
        var (_, r, _) = Start(1);
        var free = Catalog.All.FirstOrDefault(s => s.Titles.Count == 0);
        if (free != null) Assert.Empty(GameEngine.Titles(free, r, GameEngine.World(r)));
    }
}
