using System.Text.Json.Nodes;
using PortalX.Server.Content;
using PortalX.Server.Domain;

namespace PortalX.Server.Game;

/// <summary>
/// Secret personal tasks: in each room that has them, every player gets one task of the room's pool — the same one every
/// time (it follows from the player's seat and the room), so it survives a refresh or a reconnection without being stored,
/// and players in different seats get different tasks. Only the player sees their task; completing it gives personal
/// points once and never opens or blocks anything.
/// </summary>
public sealed partial class GameEngine
{
    /// <summary>The task of this player in the room the group is in now, or null when the room has none.</summary>
    public PersonalTaskContent? AssignedTask(GameRoom room, PlayerSession player)
    {
        var scenario = catalog.Get(room.ScenarioId);
        var zone = CurrentZone(room).Zone;
        var pool = scenario.PersonalTasks.Where(t => t.Zone == zone).ToList();
        if (pool.Count == 0) return null;
        var zoneOrder = scenario.Zones.FirstOrDefault(z => z.Id == zone)?.Order ?? 0;
        return pool[((player.Seat + zoneOrder) % pool.Count + pool.Count) % pool.Count];
    }

    private static string TaskKey(PersonalTaskContent task, Guid playerId) => $"{task.Id}:{playerId}";

    /// <summary>Read only by the player it belongs to (GetPersonalTask): the task's text and whether it is done.</summary>
    public ActionOutcome PersonalTaskView(GameRoom room, Guid playerId)
    {
        var player = FindPlayer(room, playerId);
        if (player == null) return NotInRoom();
        if (room.Phase != RoomPhase.Playing) return new ActionOutcome(true, "none", "", [], false, new JsonObject());
        var task = AssignedTask(room, player);
        if (task == null) return new ActionOutcome(true, "none", "", [], false, new JsonObject());
        var done = World(room).TasksDone.Contains(TaskKey(task, playerId));
        return new ActionOutcome(true, "task", task.Text, [], false,
            new JsonObject { ["id"] = task.Id, ["zone"] = task.Zone, ["text"] = task.Text, ["done"] = done, ["found"] = done ? task.Found : null });
    }

    /// <summary>The player found what their task asked for. Only their own current task counts, and only once.</summary>
    public ActionOutcome CompleteTask(GameRoom room, Guid playerId, string taskId, DateTime now)
    {
        var player = FindPlayer(room, playerId);
        if (player == null) return NotInRoom();
        if (room.Phase != RoomPhase.Playing) return ActionOutcome.Fail("not-playing", "המשחק אינו פעיל כרגע.");
        var task = AssignedTask(room, player);
        if (task == null || task.Id != taskId) return ActionOutcome.Fail("not-your-task", "זה לא חלק מהמשימה האישית שלכם.");
        var world = World(room);
        var key = TaskKey(task, playerId);
        if (world.TasksDone.Contains(key)) return new ActionOutcome(true, "known", task.Found, [], false);
        world.TasksDone.Add(key);
        Contribute(world, playerId);
        var scenario = catalog.Get(room.ScenarioId);
        var notices = new List<GameNotice>();
        // the shared notice says only that a personal task was completed — never what it was
        Award(world, scenario, $"task:{task.Id}:{playerId}", player, scenario.Scoring?.Task ?? 0, "task", "משימה אישית הושלמה", task.Zone, null, now, notices);
        SaveWorld(room, world, now);
        return new ActionOutcome(true, "task-done", task.Found, notices, true, new JsonObject { ["id"] = task.Id });
    }
}
