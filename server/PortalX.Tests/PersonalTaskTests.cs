using System.Text.Json;
using PortalX.Server.Content;
using PortalX.Server.Domain;
using PortalX.Server.Game;
using static PortalX.Tests.GameEngineTests;

namespace PortalX.Tests;

/// <summary>Secret personal tasks: one per player and room, seen only by that player, worth points once, never blocking.</summary>
public class PersonalTaskTests
{
    private static readonly DateTime T0 = new(2026, 12, 14, 18, 0, 0, DateTimeKind.Utc);
    private static ScenarioContent Content => Catalog.Get("hanukkah-oil");

    private static (GameEngine e, GameRoom r, List<PlayerSession> ps) Start(int players)
    {
        var e = new GameEngine(Catalog, new GameOptions());
        var r = e.CreateRoom("hanukkah-oil", "TSK234", "hash", T0);
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

    private static string TaskOf(GameEngine e, GameRoom r, PlayerSession p) => e.PersonalTaskView(r, p.Id).Data!["id"]!.GetValue<string>();
    private static int Personal(GameRoom r, PlayerSession p) => GameEngine.World(r).Score!.Personal.GetValueOrDefault(p.Id.ToString());

    [Fact]
    public void Every_player_gets_a_different_task_of_the_room_and_always_the_same_one()
    {
        var (e, r, ps) = Start(4);
        var tasks = ps.Select(p => TaskOf(e, r, p)).ToList();
        Assert.Equal(4, tasks.Distinct().Count());
        Assert.All(tasks, t => Assert.Equal("library", Content.PersonalTasks.Single(x => x.Id == t).Zone));
        // asking again (a refresh, a reconnection, another engine reading the same saved game) gives the same task
        Assert.Equal(tasks, ps.Select(p => TaskOf(e, r, p)).ToList());
        var again = new GameEngine(Catalog, new GameOptions());
        Assert.Equal(tasks, ps.Select(p => TaskOf(again, r, p)).ToList());
        // a player's view holds only their own task
        var view = e.PersonalTaskView(r, ps[0].Id).Data!.ToJsonString();
        foreach (var other in tasks.Skip(1)) Assert.DoesNotContain(other, view);
    }

    [Fact]
    public void Completing_scores_20_once_only_for_the_owner_and_tells_the_others_nothing()
    {
        var (e, r, ps) = Start(2);
        var mine = TaskOf(e, r, ps[0]);
        var theirs = TaskOf(e, r, ps[1]);
        var text = Content.PersonalTasks.Single(t => t.Id == mine).Text;

        Assert.Equal("not-your-task", e.CompleteTask(r, ps[1].Id, mine, T0).Code);   // nobody completes someone else's task
        var done = e.CompleteTask(r, ps[0].Id, mine, T0);
        Assert.Equal("task-done", done.Code);
        Assert.Equal(Content.PersonalTasks.Single(t => t.Id == mine).Found, done.Message);
        Assert.Equal(20, Personal(r, ps[0]));
        Assert.Equal(0, Personal(r, ps[1]));
        // what everyone receives says only that a personal task was completed
        Assert.All(done.Notices, n => Assert.DoesNotContain(text, n.Message));
        Assert.Contains(done.Notices, n => n.Message.Contains("משימה אישית הושלמה"));
        // sending it again changes nothing
        Assert.Equal("known", e.CompleteTask(r, ps[0].Id, mine, T0).Code);
        Assert.Equal(20, Personal(r, ps[0]));
        Assert.True(e.PersonalTaskView(r, ps[0].Id).Data!["done"]!.GetValue<bool>());
        Assert.False(e.PersonalTaskView(r, ps[1].Id).Data!["done"]!.GetValue<bool>());
        // the shared state never carries tasks
        var snap = JsonSerializer.Serialize(Snapshots.Build(e, r, null, T0), ScenarioCatalog.JsonOptions);
        Assert.DoesNotContain(mine, snap);
        Assert.DoesNotContain(theirs, snap);
        Assert.Equal(GameEngine.World(r).Score!.Log.Count, GameEngine.World(r).Score!.Log.Select(x => x.Key).Distinct().Count());
    }

    [Fact]
    public void A_task_never_blocks_the_room_and_the_next_room_brings_a_new_one()
    {
        var (e, r, ps) = Start(1);
        var p = ps[0];
        var first = TaskOf(e, r, p);
        // the room is solved without the task
        LibraryChain.Open(e, r, p.Id, T0);
        Assert.Equal("solved", e.SubmitAnswer(r, p.Id, "h1-riddle", J("פך השמן"), T0).Code);
        Assert.True(e.Continue(r, p.Id, T0).Ok);
        var second = TaskOf(e, r, p);
        Assert.NotEqual(first, second);
        Assert.Equal("workshop", Content.PersonalTasks.Single(t => t.Id == second).Zone);
        // the library's task can no longer be completed once the group has moved on
        Assert.Equal("not-your-task", e.CompleteTask(r, p.Id, first, T0).Code);
        Assert.Equal("task-done", e.CompleteTask(r, p.Id, second, T0).Code);
    }

    [Fact]
    public void The_public_scenario_sent_to_every_player_holds_no_task()
    {
        var pub = Snapshots.PublicScenario(Content).ToJsonString();
        Assert.DoesNotContain("personalTasks", pub);
        Assert.All(Content.PersonalTasks, t => Assert.DoesNotContain(t.Id, pub));
    }

    [Fact]
    public void Rooms_one_to_six_have_four_tasks_each_and_rooms_seven_and_eight_none()
    {
        foreach (var z in new[] { "library", "workshop", "maze", "cipher", "dreidels", "lab" })
            Assert.Equal(4, Content.PersonalTasks.Count(t => t.Zone == z));
        Assert.DoesNotContain(Content.PersonalTasks, t => t.Zone is "mosaic" or "hall");
        Assert.Equal(20, Content.Scoring!.Task);
    }

    [Fact]
    public void A_late_joiner_gets_their_own_task_too()
    {
        var (e, r, ps) = Start(2);
        Assert.True(e.AddPlayer(r, "מאוחר", "navigator", "{}", "t9", false, T0, out var late).Ok);
        late!.IsConnected = true;
        var tasks = ps.Select(p => TaskOf(e, r, p)).Append(TaskOf(e, r, late)).ToList();
        Assert.Equal(3, tasks.Distinct().Count());
        Assert.Equal("task-done", e.CompleteTask(r, late.Id, tasks[2], T0).Code);
    }
}
