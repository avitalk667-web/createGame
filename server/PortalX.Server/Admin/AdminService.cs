using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using PortalX.Server.Content;
using PortalX.Server.Data;
using PortalX.Server.Domain;
using PortalX.Server.Game;
using PortalX.Server.Payments;

namespace PortalX.Server.Admin;

/// <summary>Filters shared by the dashboard, the purchases table, the CSV export and the games table.</summary>
public sealed record AdminFilter(DateTime? From, DateTime? To, string? ProductId, string? Status, string? Access, string? Search, bool IncludeTest)
{
    public static AdminFilter Parse(HttpRequest r)
    {
        static DateTime? Date(string? s, bool endOfDay) =>
            DateTime.TryParse(s, System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.AdjustToUniversal | System.Globalization.DateTimeStyles.AssumeUniversal, out var d)
                ? (endOfDay && d.TimeOfDay == TimeSpan.Zero ? d.AddDays(1) : d) : null;
        string? S(string k) => string.IsNullOrWhiteSpace(r.Query[k]) ? null : r.Query[k].ToString().Trim();
        return new AdminFilter(Date(S("from"), false), Date(S("to"), true), S("productId"), S("status"), S("access"), S("search"),
            r.Query["includeTest"] == "true");
    }
}

/// <param name="SaleDate">Opening date for purchase, "yyyy-MM-dd" in Israel time (with SaleTime "HH:mm"); ClearSaleOpening removes it.</param>
public sealed record ProductUpdate(string? Name, string? Tagline, string? Description, string? CoverImage, decimal? PriceIls,
    bool ClearPrice, string? Status, int? MaxPlayers, string? SaleDate = null, string? SaleTime = null, bool ClearSaleOpening = false,
    bool? ShowBeforeSale = null, bool? SalePaused = null, decimal? PreviousPriceIls = null, bool ClearPreviousPrice = false);

/// <summary>
/// Admin reports and actions. Revenue counts only confirmed, non-test payments; admin free games never count
/// as revenue or as paid games. Nothing here returns payment card data (none is stored).
/// </summary>
public sealed class AdminService(PortalDbContext db, ScenarioCatalog scenarios, RoomService rooms, ILogger<AdminService> logger)
{
    public const string TrialOrderAction = "sumit-trial-order";

    /// <summary>A trial purchase whose payment link may still be open.</summary>
    public Task<bool> RecentTrialOrderAsync()
    {
        var since = DateTime.UtcNow.AddHours(-1);
        return db.AdminAuditLog.AnyAsync(a => a.Action == TrialOrderAction && a.CreatedAt > since);
    }

    public async Task AuditAsync(string admin, string action, string? targetType, string? targetId, object? details = null)
    {
        db.AdminAuditLog.Add(new AdminAuditLog
        {
            AdminName = admin, Action = action, TargetType = targetType, TargetId = targetId,
            DetailsJson = JsonSerializer.Serialize(details ?? new { }), CreatedAt = DateTime.UtcNow,
        });
        await db.SaveChangesAsync();
        logger.LogInformation("Admin {Admin}: {Action} {Type} {Id}", admin, action, targetType, targetId);
    }

    private IQueryable<Order> Orders(AdminFilter f)
    {
        var q = db.Orders.AsNoTracking();
        if (!f.IncludeTest) q = q.Where(o => !o.IsTest);
        if (f.From is { } from) q = q.Where(o => o.CreatedAt >= from);
        if (f.To is { } to) q = q.Where(o => o.CreatedAt < to);
        if (f.ProductId != null) q = q.Where(o => o.ProductId == f.ProductId);
        if (f.Status != null && Enum.TryParse<OrderStatus>(f.Status, true, out var st)) q = q.Where(o => o.Status == st);
        if (f.Search != null)
        {
            var s = f.Search.ToLower();
            q = long.TryParse(f.Search.TrimStart('#'), out var n)
                ? q.Where(o => o.Number == n || (o.Email != null && o.Email.ToLower().Contains(s)))
                : q.Where(o => o.Email != null && o.Email.ToLower().Contains(s));
        }
        return q;
    }

    private sealed record RoomRow(GameRoom Room, Entitlement? Ent, Order? Order, int Players, GameResult? Result);

    // A game counts as started once it left the lobby or has a result, and as completed when it reached the end or its
    // latest result is a success. The same rules serve the purchases table (below) and the SQL of the dashboard and games.
    private static bool Started(RoomPhase phase, bool hasResult) => phase != RoomPhase.Lobby || hasResult;
    private static bool Completed(RoomPhase phase, string? latestCompletion) => phase == RoomPhase.Completed || latestCompletion == "success";
    private static string GameStatus(RoomPhase phase, bool hasResult, string? latestCompletion) =>
        Completed(phase, latestCompletion) ? "completed" : Started(phase, hasResult) ? "in-progress" : "not-started";
    private static string GameStatus(RoomRow r) => GameStatus(r.Room.Phase, r.Result != null, r.Result?.CompletionType);

    /// <summary>The rooms of the dashboard and the games table: the period and game filters (when the room was opened).</summary>
    private IQueryable<GameRoom> RoomsIn(AdminFilter f)
    {
        var q = db.Rooms.AsNoTracking();
        if (f.From is { } from) q = q.Where(r => r.CreatedAt >= from);
        if (f.To is { } to) q = q.Where(r => r.CreatedAt < to);
        if (f.ProductId != null) q = q.Where(r => r.ProductId == f.ProductId);
        return q;
    }

    /// <summary>One group of rooms with the same kind and state, counted by the database (no room rows or game state are read).</summary>
    private sealed record RoomGroup(string AccessSource, string? ProductId, string ScenarioId, bool IsTest, bool Started, bool Completed,
        int Count, int Players, int Seats);

    private async Task<List<RoomGroup>> RoomGroupsAsync(AdminFilter f) =>
        (await RoomsIn(f)
            .Select(r => new
            {
                r.AccessSource, r.ProductId, r.ScenarioId,
                // a room whose entitlement is a test purchase is left out unless test purchases are included
                IsTest = db.Entitlements.Any(e => e.Id == r.EntitlementId && e.IsTest),
                Started = r.Phase != RoomPhase.Lobby || db.Results.Any(x => x.RoomId == r.Id),
                Completed = r.Phase == RoomPhase.Completed
                    || db.Results.Where(x => x.RoomId == r.Id).OrderByDescending(x => x.CreatedAt).Select(x => x.CompletionType).FirstOrDefault() == "success",
                Players = db.Players.Count(p => p.RoomId == r.Id && !p.IsRemoved),
                // every seat ever taken, also by players who later left (the free trial report)
                Seats = db.Players.Count(p => p.RoomId == r.Id),
            })
            .GroupBy(x => new { x.AccessSource, x.ProductId, x.ScenarioId, x.IsTest, x.Started, x.Completed })
            .Select(g => new { g.Key, Count = g.Count(), Players = g.Sum(x => x.Players), Seats = g.Sum(x => x.Seats) })
            .ToListAsync())
        .Select(g => new RoomGroup(g.Key.AccessSource, g.Key.ProductId, g.Key.ScenarioId, g.Key.IsTest, g.Key.Started, g.Key.Completed, g.Count, g.Players, g.Seats))
        .ToList();

    /// <summary>
    /// Totals of the dashboard. Every figure is counted and summed by the database (grouped queries), so no order or room
    /// rows and no game state are read; the figures and their rules are exactly those of the earlier in-memory version.
    /// </summary>
    public async Task<object> DashboardAsync(AdminFilter f)
    {
        var orderFilter = f with { Status = null, Search = null };
        var orderGroups = await Orders(orderFilter)
            .GroupBy(o => new { o.ProductId, o.Status })
            .Select(g => new
            {
                g.Key.ProductId, g.Key.Status, Count = g.Count(),
                Price = g.Sum(o => o.PriceSnapshot),
                Refund = g.Sum(o => o.RefundedAmount ?? o.PriceSnapshot),
            })
            .ToListAsync();
        var buyersWithEmail = await Orders(orderFilter)
            .Where(o => (o.Status == OrderStatus.Paid || o.Status == OrderStatus.Refunded) && o.Email != null)
            .Select(o => o.Email!.ToLower()).Distinct().CountAsync();

        var roomFilter = f with { Status = null, Search = null, Access = null };
        var all = await RoomGroupsAsync(roomFilter);
        var rooms = all.Where(g => f.IncludeTest || !g.IsTest).ToList();
        var managed = rooms.Where(g => g.AccessSource is "purchase" or "admin-free").ToList();
        var paidRooms = managed.Where(g => g.AccessSource == "purchase").ToList();
        var freeRooms = managed.Where(g => g.AccessSource == "admin-free").ToList();
        // free trial games: shown separately, never part of the revenue or of the paid games
        var sampleRooms = rooms.Where(g => g.AccessSource == "free-sample").ToList();
        // games from the demo mode that no longer exists: history only, never sales, revenue or paid games (test ones too)
        var demoRooms = all.Where(g => g.AccessSource == RoomService.LegacyDemoAccess).ToList();
        var products = await db.Products.AsNoTracking().OrderBy(p => p.SortOrder).ToListAsync();

        // paid orders whose game was never opened (in the rooms of this period, with the same test rule as above)
        var purchaseRooms = RoomsIn(roomFilter).Where(r => r.AccessSource == "purchase");
        if (!f.IncludeTest) purchaseRooms = purchaseRooms.Where(r => !db.Entitlements.Any(e => e.Id == r.EntitlementId && e.IsTest));
        var paidNotOpened = await Orders(orderFilter).CountAsync(o => o.Status == OrderStatus.Paid
            && !purchaseRooms.Any(r => db.Entitlements.Any(e => e.Id == r.EntitlementId && e.OrderId == o.Id)));

        object Money(string? productId)
        {
            var mine = orderGroups.Where(g => productId == null || g.ProductId == productId).ToList();
            var conf = mine.Where(g => g.Status is OrderStatus.Paid or OrderStatus.Refunded).ToList();
            var refs = mine.Where(g => g.Status == OrderStatus.Refunded).ToList();
            var gross = conf.Sum(g => g.Price);
            var refunds = refs.Sum(g => g.Refund);
            return new { gross, refunds, afterRefunds = gross - refunds, paidCount = conf.Sum(g => g.Count), refundCount = refs.Sum(g => g.Count) };
        }
        object NoMoney() => new { gross = 0m, refunds = 0m, afterRefunds = 0m, paidCount = 0, refundCount = 0 };
        int Count(IEnumerable<RoomGroup> g) => g.Sum(x => x.Count);
        int CountOrders(OrderStatus s) => orderGroups.Where(g => g.Status == s).Sum(g => g.Count);

        return new
        {
            currency = "ILS",
            includesTest = f.IncludeTest,
            revenue = Money(null),
            byProduct = products.Where(p => f.ProductId == null || p.Id == f.ProductId).Select(p => new
            {
                productId = p.Id, name = p.Name, p.IsFree,
                // a free game has no sales: its money is always zero and its games are the free trial runs
                money = p.IsFree ? NoMoney() : Money(p.Id),
                games = p.IsFree ? Count(sampleRooms.Where(g => g.ProductId == p.Id)) : Count(managed.Where(g => g.ProductId == p.Id)),
            }),
            freeGame = await FreeGameReportAsync(sampleRooms, products.FirstOrDefault(p => p.IsFree)),
            buyersWithEmail,
            orders = new
            {
                pending = CountOrders(OrderStatus.Pending),
                failed = CountOrders(OrderStatus.Failed),
                cancelled = CountOrders(OrderStatus.Cancelled),
            },
            games = new
            {
                opened = Count(managed),
                started = Count(managed.Where(g => g.Started)),
                completed = Count(managed.Where(g => g.Completed)),
                paidStarted = Count(paidRooms.Where(g => g.Started)),
                adminFree = Count(freeRooms),
                adminFreeStarted = Count(freeRooms.Where(g => g.Started)),
                freeSample = Count(sampleRooms),
                freeSampleStarted = Count(sampleRooms.Where(g => g.Started)),
                freeSampleCompleted = Count(sampleRooms.Where(g => g.Completed)),
                freeSamplePlayers = sampleRooms.Sum(g => g.Players),
                demo = Count(demoRooms),
                demoStarted = Count(demoRooms.Where(g => g.Started)),
                demoCompleted = Count(demoRooms.Where(g => g.Completed)),
                // paid but not started: a room still in the lobby, or a paid order whose game was never opened
                purchasedNotStarted = Count(paidRooms.Where(g => !g.Started)) + paidNotOpened,
            },
            // without customer accounts a person is counted once per game they joined (a reconnect keeps the same seat)
            participants = managed.Sum(g => g.Players),
            testPaidOrders = f.IncludeTest ? (int?)null : await db.Orders.CountAsync(o => o.IsTest && (o.Status == OrderStatus.Paid || o.Status == OrderStatus.Refunded)),
        };
    }

    /// <summary>Start of today in Israel, as UTC (the "today" figures of the reports).</summary>
    public static DateTime IsraelTodayStartUtc(DateTime utcNow)
    {
        TimeZoneInfo zone;
        try { zone = TimeZoneInfo.FindSystemTimeZoneById("Asia/Jerusalem"); }
        catch (Exception) { zone = TimeZoneInfo.CreateCustomTimeZone("IL", TimeSpan.FromHours(2), "IL", "IL"); }
        var local = TimeZoneInfo.ConvertTimeFromUtc(utcNow, zone).Date;
        return TimeZoneInfo.ConvertTimeToUtc(DateTime.SpecifyKind(local, DateTimeKind.Unspecified), zone);
    }

    /// <summary>
    /// Report of the free trial game (spec 3): games and players are counted apart. A game counts once by its room,
    /// however often players refresh or come back; a player counts once per game by their seat, because a reconnect
    /// returns to the same seat. Without customer accounts the same person in two different games counts twice.
    /// The period filter applies to when a game was opened; the "today" figures always cover today in Israel.
    /// </summary>
    private async Task<object?> FreeGameReportAsync(List<RoomGroup> sampleRooms, Product? product)
    {
        if (product == null) return null;
        var rows = sampleRooms.Where(g => g.ProductId == product.Id || g.ScenarioId == product.ScenarioId).ToList();
        var started = rows.Where(g => g.Started).ToList();
        var created = rows.Sum(g => g.Count);
        var startedCount = started.Sum(g => g.Count);

        var today = IsraelTodayStartUtc(DateTime.UtcNow);
        var all = db.Rooms.AsNoTracking().Where(r => r.AccessSource == "free-sample");
        var startedToday = await all.CountAsync(r => (r.IntroStartedAt ?? r.StartedAt) >= today);
        var completedToday = await all.CountAsync(r => r.Phase == RoomPhase.Completed && r.EndedAt >= today);
        var joinedToday = await db.Players.AsNoTracking().CountAsync(p => p.JoinedAt >= today
            && db.Rooms.Any(r => r.Id == p.RoomId && r.AccessSource == "free-sample"));
        var lastStarted = await all.Where(r => r.IntroStartedAt != null || r.StartedAt != null)
            .MaxAsync(r => (DateTime?)(r.IntroStartedAt ?? r.StartedAt));

        return new
        {
            productId = product.Id, name = product.Name, kind = "free",
            created,
            started = startedCount,
            notStarted = created - startedCount,
            completed = rows.Where(g => g.Completed).Sum(g => g.Count),
            // everyone who took a seat, also players who later left the game (a seat belongs to one room)
            participants = rows.Sum(g => g.Seats),
            participantsInStarted = started.Sum(g => g.Seats),
            lastStartedAt = lastStarted,
            today = new { started = startedToday, completed = completedToday, joined = joinedToday },
            revenue = 0,
        };
    }

    public async Task<List<Dictionary<string, object?>>> OrderRowsAsync(AdminFilter f)
    {
        var orders = await Orders(f).OrderByDescending(o => o.CreatedAt).Take(1000).ToListAsync();
        var ids = orders.Select(o => o.Id).ToList();
        var ents = await db.Entitlements.AsNoTracking().Where(e => e.OrderId != null && ids.Contains(e.OrderId.Value)).ToListAsync();
        var entIds = ents.Select(e => e.Id).ToList();
        var roomsByEnt = await db.Rooms.AsNoTracking().Include(r => r.Players).Where(r => r.EntitlementId != null && entIds.Contains(r.EntitlementId.Value))
            .ToDictionaryAsync(r => r.EntitlementId!.Value);
        var roomIds = roomsByEnt.Values.Select(r => r.Id).ToList();
        var results = await db.Results.AsNoTracking().Where(r => roomIds.Contains(r.RoomId)).Select(r => r.RoomId).Distinct().ToListAsync();
        return orders.Select(o =>
        {
            var ent = ents.FirstOrDefault(e => e.OrderId == o.Id);
            var room = ent != null && roomsByEnt.TryGetValue(ent.Id, out var r) ? r : null;
            var row = room == null ? null : new RoomRow(room, ent, o, room.Players.Count(p => !p.IsRemoved), results.Contains(room.Id) ? new GameResult() : null);
            return new Dictionary<string, object?>
            {
                ["id"] = o.Id, ["number"] = o.Number, ["createdAt"] = o.CreatedAt, ["email"] = o.Email,
                ["productId"] = o.ProductId, ["productName"] = o.ProductName, ["amount"] = o.PriceSnapshot, ["currency"] = o.Currency,
                ["status"] = o.Status.ToString().ToLowerInvariant(), ["provider"] = o.Provider, ["transactionId"] = o.ProviderTransactionId,
                ["originalPrice"] = o.OriginalPrice ?? o.PriceSnapshot, ["discount"] = o.DiscountAmount, ["couponCode"] = o.CouponCode,
                ["documentId"] = o.ProviderDocumentId, ["documentNumber"] = o.ProviderDocumentNumber, ["issue"] = o.ProviderIssue,
                ["verifiedAt"] = o.PaymentVerifiedAt,
                ["isTest"] = o.IsTest, ["paidAt"] = o.PaidAt, ["refundedAt"] = o.RefundedAt, ["refundedAmount"] = o.RefundedAmount,
                ["gameCode"] = room?.Code, ["players"] = row?.Players ?? 0,
                ["gameStatus"] = row == null ? (o.Status == OrderStatus.Paid ? "not-opened" : null) : GameStatus(row),
            };
        }).ToList();
    }

    private static readonly Dictionary<string, string> StatusHe = new()
    {
        ["pending"] = "ממתין", ["paid"] = "שולם", ["failed"] = "נכשל", ["cancelled"] = "בוטל", ["refunded"] = "הוחזר",
        ["not-opened"] = "טרם נפתח", ["not-started"] = "טרם התחיל", ["in-progress"] = "בתהליך", ["completed"] = "הושלם",
    };

    /// <summary>Sales export (spec §13). UTF-8 with BOM so Excel shows Hebrew; cells that look like formulas are neutralised.</summary>
    public async Task<byte[]> OrdersCsvAsync(AdminFilter f)
    {
        static string Cell(object? v)
        {
            var s = v switch
            {
                null => "",
                DateTime d => d.ToString("yyyy-MM-dd HH:mm") + " UTC",
                decimal m => m.ToString("0.00", System.Globalization.CultureInfo.InvariantCulture),
                bool b => b ? "כן" : "לא",
                _ => v.ToString() ?? "",
            };
            if (s.Length > 0 && "=+-@\t\r".Contains(s[0])) s = "'" + s;
            return s.IndexOfAny([',', '"', '\n', '\r']) >= 0 ? "\"" + s.Replace("\"", "\"\"") + "\"" : s;
        }
        var cols = new (string Key, string Title)[]
        {
            ("number", "מספר הזמנה"), ("createdAt", "תאריך"), ("email", "דוא\"ל"), ("productName", "משחק"), ("originalPrice", "מחיר מקורי"),
            ("discount", "הנחה"), ("couponCode", "קופון"), ("amount", "סכום ששולם"),
            ("currency", "מטבע"), ("status", "סטטוס תשלום"), ("provider", "ספק סליקה"), ("transactionId", "מזהה עסקה"),
            ("isTest", "בדיקה"), ("refundedAmount", "סכום החזר"), ("gameCode", "קוד משחק"), ("players", "משתתפים"), ("gameStatus", "סטטוס משחק"),
            ("documentNumber", "מספר מסמך"), ("issue", "לטיפול"),
        };
        var sb = new StringBuilder();
        sb.AppendLine(string.Join(",", cols.Select(c => Cell(c.Title))));
        foreach (var row in await OrderRowsAsync(f))
            sb.AppendLine(string.Join(",", cols.Select(c =>
            {
                var v = row[c.Key];
                return Cell(c.Key is "status" or "gameStatus" && v is string st && StatusHe.TryGetValue(st, out var he) ? he : v);
            })));
        return [.. Encoding.UTF8.GetPreamble(), .. Encoding.UTF8.GetBytes(sb.ToString())];
    }

    /// <summary>The group score of each room, read inside the database from the saved game state (never the whole state).</summary>
    private sealed record RoomScore(Guid Id, int? Group);

    /// <summary>
    /// The games table: the newest 1000 rooms of the filter, then test purchases left out unless included (as before).
    /// Only the shown columns are read: the latest result of each room, its player count, its order number and the group
    /// score (taken from the game state by the database, the same value GameEngine.World(room).Score?.Group gives).
    /// </summary>
    public async Task<object> GamesAsync(AdminFilter f)
    {
        var q = RoomsIn(f);
        if (f.Access != null) q = q.Where(r => r.AccessSource == f.Access);
        if (f.Search != null) q = q.Where(r => r.Code == RoomService.NormalizeCode(f.Search));
        var rows = await q.OrderByDescending(r => r.CreatedAt).Take(1000)
            .Select(r => new
            {
                r.Id, r.Code, r.ProductId, r.ScenarioId, r.AccessSource, r.CreatedAt, r.IntroStartedAt, r.StartedAt, r.EndedAt, r.Phase, r.DisabledAt,
                Ent = db.Entitlements.Where(e => e.Id == r.EntitlementId).Select(e => new { e.IsTest, e.OrderId }).FirstOrDefault(),
                OrderNumber = db.Entitlements.Where(e => e.Id == r.EntitlementId)
                    .SelectMany(e => db.Orders.Where(o => o.Id == e.OrderId)).Select(o => (long?)o.Number).FirstOrDefault(),
                Players = db.Players.Count(p => p.RoomId == r.Id && !p.IsRemoved),
                Result = db.Results.Where(x => x.RoomId == r.Id).OrderByDescending(x => x.CreatedAt)
                    .Select(x => new { x.DurationSeconds, x.HintsUsed, x.PuzzlesSolved, x.PuzzlesTotal, x.CompletionType }).FirstOrDefault(),
            })
            .ToListAsync();
        if (!f.IncludeTest) rows = rows.Where(r => r.Ent?.IsTest != true).ToList();

        var ids = rows.Select(r => r.Id).ToArray();
        // System.Text.Json reads "score" and "group" without regard to case; the server always writes them in camelCase.
        // A missing or null score gives null; a score without "group" gives 0 (the default of ScoreBoard.Group).
        var scores = ids.Length == 0 ? [] : await db.Database.SqlQuery<RoomScore>($"""
            SELECT r."Id",
                   CASE WHEN jsonb_typeof(r."WorldJson" -> 'score') = 'object'
                        THEN COALESCE((r."WorldJson" -> 'score' ->> 'group')::int, 0) END AS "Group"
            FROM "Rooms" AS r WHERE r."Id" = ANY({ids})
            """).ToListAsync();
        var groupScore = scores.ToDictionary(s => s.Id, s => s.Group);

        var names = await db.Products.AsNoTracking().ToDictionaryAsync(p => p.Id, p => p.Name);
        return rows.Select(r => new
        {
            r.Code,
            productId = r.ProductId,
            productName = r.ProductId != null && names.TryGetValue(r.ProductId, out var n) ? n : scenarios.Find(r.ScenarioId)?.Name,
            access = r.AccessSource,
            isTest = r.Ent?.IsTest ?? false,
            orderNumber = r.OrderNumber,
            owner = r.AccessSource switch { "admin-free" => "מנהל", "treasure" => "מתנה מתיבת האוצר", "free-sample" => "משחק התנסות חינמי", RoomService.LegacyDemoAccess => "הדגמה ישנה (סגור)", _ => r.OrderNumber != null ? $"הזמנה {r.OrderNumber}" : null },
            r.CreatedAt,
            startedAt = r.IntroStartedAt ?? r.StartedAt,
            r.EndedAt,
            players = r.Players,
            phase = r.Phase.ToString().ToLowerInvariant(),
            status = GameStatus(r.Phase, r.Result != null, r.Result?.CompletionType),
            result = r.Result == null ? null : new
            {
                r.Result.DurationSeconds, r.Result.HintsUsed, r.Result.PuzzlesSolved, r.Result.PuzzlesTotal, r.Result.CompletionType,
            },
            groupScore = groupScore.GetValueOrDefault(r.Id),
            disabled = r.DisabledAt != null,
        });
    }

    /// <summary>
    /// Switches a game code off (or on again). Any game: bought, free, a gift or a sample. Only the room is marked — the order,
    /// the payment, the results and the reports stay exactly as they were, and no one is emailed. Returns the room, or null.
    /// </summary>
    public async Task<(Guid RoomId, bool Changed)?> SetGameDisabledAsync(string code, bool disabled, string admin)
    {
        var normalized = RoomService.NormalizeCode(code);
        var roomId = await db.Rooms.Where(r => r.Code == normalized).Select(r => (Guid?)r.Id).FirstOrDefaultAsync();
        if (roomId == null) return null;
        var now = DateTime.UtcNow;
        // conditional, so a second click (or two admins at once) changes nothing and is not audited twice
        var changed = disabled
            ? await db.Rooms.Where(r => r.Id == roomId && r.DisabledAt == null).ExecuteUpdateAsync(u => u
                .SetProperty(r => r.DisabledAt, now).SetProperty(r => r.DisabledBy, admin).SetProperty(r => r.UpdatedAt, now))
            : await db.Rooms.Where(r => r.Id == roomId && r.DisabledAt != null).ExecuteUpdateAsync(u => u
                .SetProperty(r => r.DisabledAt, (DateTime?)null).SetProperty(r => r.DisabledBy, (string?)null).SetProperty(r => r.UpdatedAt, now));
        return (roomId.Value, changed > 0);
    }

    /// <summary>Support view of one game: players, progress and results (spec §14).</summary>
    public async Task<object?> GameDetailsAsync(string code)
    {
        var room = await db.Rooms.AsNoTracking().Include(r => r.Players).Include(r => r.Puzzles)
            .FirstOrDefaultAsync(r => r.Code == RoomService.NormalizeCode(code));
        if (room == null) return null;
        var world = JsonSerializer.Deserialize<WorldState>(room.WorldJson, ScenarioCatalog.JsonOptions) ?? new WorldState();
        var scenario = scenarios.Find(room.ScenarioId);
        var results = await db.Results.AsNoTracking().Where(r => r.RoomId == room.Id).OrderByDescending(r => r.CreatedAt).ToListAsync();
        return new
        {
            room.Code, room.ScenarioId, room.ProductId, access = room.AccessSource,
            phase = room.Phase.ToString().ToLowerInvariant(), room.CreatedAt, startedAt = room.IntroStartedAt ?? room.StartedAt, room.EndedAt, room.Round,
            room.DisabledAt, room.DisabledBy,
            players = room.Players.Where(p => !p.IsRemoved).OrderBy(p => p.Seat).Select(p => new
            {
                p.Nickname, p.CharacterId, p.IsConnected, p.JoinedAt, p.LastSeenAt, isHost = p.Id == room.HostPlayerId,
                contributions = world.Contributions.GetValueOrDefault(p.Id.ToString()),
                points = world.Score?.Personal.GetValueOrDefault(p.Id.ToString()),
            }),
            groupScore = world.Score?.Group,
            roomScores = world.Score?.Rooms,
            puzzles = room.Puzzles.OrderBy(p => scenario?.Puzzles.FirstOrDefault(x => x.Id == p.PuzzleId)?.Order ?? 99).Select(p => new
            {
                p.PuzzleId, title = scenario?.Puzzles.FirstOrDefault(x => x.Id == p.PuzzleId)?.Title,
                status = p.Status.ToString().ToLowerInvariant(), p.Attempts, p.HintsRevealed, p.SolvedAt,
            }),
            results = results.Select(r => new { r.Round, r.DurationSeconds, r.HintsUsed, r.WrongAttempts, r.PuzzlesSolved, r.PuzzlesTotal, r.CompletionType, r.CreatedAt }),
        };
    }

    // ------------------------------------------------------------------ products

    public async Task<object> ProductsAsync() =>
        (await db.Products.AsNoTracking().OrderBy(p => p.SortOrder).ToListAsync()).Select(ProductRow).ToList();

    private object ProductRow(Product p) => new
        {
            p.Id, p.Name, p.Tagline, p.Description, p.CoverImage, price = p.PriceIls, previousPrice = p.PreviousPriceIls, p.Currency,
            status = p.Status.ToString().ToLowerInvariant(), p.MinPlayers, p.MaxPlayers, p.ScenarioId, p.UpdatedAt, p.IsFree,
            maxPlayersLimit = rooms.Engine.MaxPlayersLimit,
            playable = PurchaseService.IsPlayable(p, scenarios),
            warnings = Warnings(p),
            // purchase availability: the opening time is shown and edited in Israel time
            saleDate = p.SaleOpensAt is { } d ? SaleWindow.ToIsrael(d).ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture) : null,
            saleTime = p.SaleOpensAt is { } t ? SaleWindow.ToIsrael(t).ToString("HH:mm", System.Globalization.CultureInfo.InvariantCulture) : null,
            saleOpensLabel = p.SaleOpensAt is { } l ? SaleWindow.Label(l) : null,
            p.ShowBeforeSale, p.SalePaused,
            saleState = SaleWindow.State(p, DateTime.UtcNow),
        };

    private List<string> Warnings(Product p)
    {
        var w = new List<string>();
        if (p.PriceIls is not > 0) w.Add("למוצר אין מחיר. אי אפשר לרכוש אותו עד שייקבע מחיר.");
        if (!PurchaseService.IsPlayable(p, scenarios)) w.Add("תוכן המשחק עדיין לא קיים בשרת, ולכן אי אפשר לרכוש או לפתוח אותו.");
        return w;
    }

    public async Task<(object? Product, string? Error)> UpdateProductAsync(string id, ProductUpdate u, string admin)
    {
        var p = await db.Products.FirstOrDefaultAsync(x => x.Id == id);
        if (p == null) return (null, "המוצר לא נמצא.");
        var before = new { p.Name, p.PriceIls, p.PreviousPriceIls, Status = p.Status.ToString(), p.MaxPlayers, p.CoverImage, p.SaleOpensAt, p.ShowBeforeSale, p.SalePaused };

        if (u.Name != null) { if (u.Name.Trim().Length is < 2 or > 80) return (null, "שם המוצר צריך להיות באורך 2–80 תווים."); p.Name = u.Name.Trim(); }
        if (u.Tagline != null) { if (u.Tagline.Length > 200) return (null, "התקציר ארוך מדי (עד 200 תווים)."); p.Tagline = u.Tagline.Trim(); }
        if (u.Description != null) { if (u.Description.Length > 4000) return (null, "התיאור ארוך מדי."); p.Description = u.Description.Trim(); }
        if (u.CoverImage != null)
        {
            var img = u.CoverImage.Trim();
            // a path on this site only: no external or script URLs
            if (!System.Text.RegularExpressions.Regex.IsMatch(img, @"^img/[A-Za-z0-9_\-/]+\.(jpg|jpeg|png|webp)$")) return (null, "תמונת הכיסוי צריכה להיות קובץ מתיקיית img באתר, למשל img/hanukkah/kids.jpg.");
            p.CoverImage = img;
        }
        if (u.ClearPrice) p.PriceIls = null;
        else if (u.PriceIls is { } price)
        {
            if (price <= 0 || price > 10000 || decimal.Round(price, 2) != price) return (null, "המחיר צריך להיות סכום חיובי בשקלים, עד שתי ספרות אחרי הנקודה.");
            p.PriceIls = price;
        }
        // the previous price is checked again whenever either price changes, against the price that will be saved
        if (u.ClearPreviousPrice) p.PreviousPriceIls = null;
        else if (u.PreviousPriceIls is { } was) p.PreviousPriceIls = was;
        if (ProductPricing.Validate(p.PreviousPriceIls, p.PriceIls, p.IsFree) is { } priceError) return (null, priceError);
        if (u.MaxPlayers is { } max)
        {
            var cap = rooms.Engine.MaxPlayersLimit;
            if (max < 1 || max > cap || max < p.MinPlayers) return (null, $"מספר המשתתפים המרבי צריך להיות בין {Math.Max(1, p.MinPlayers)} ל־{cap}.");
            p.MaxPlayers = max;
        }
        if (u.Status != null)
        {
            if (!Enum.TryParse<ProductStatus>(u.Status, true, out var st)) return (null, "סטטוס לא מוכר.");
            p.Status = st;
        }
        if (u.ClearSaleOpening) p.SaleOpensAt = null;
        else if (u.SaleDate != null || u.SaleTime != null)
        {
            // entered in Israel time, stored as UTC, so the opening never shifts with daylight saving or the server's zone
            if (SaleWindow.FromIsrael(u.SaleDate, u.SaleTime) is not { } opens) return (null, "יש למלא תאריך ושעה תקינים לפתיחת הרכישה.");
            p.SaleOpensAt = opens;
        }
        if (u.ShowBeforeSale is { } show) p.ShowBeforeSale = show;
        if (u.SalePaused is { } paused) p.SalePaused = paused;
        // spec §6: a paid product cannot be published without a positive price
        if (p.Status == ProductStatus.Published && !p.IsFree && p.PriceIls is not > 0 && (u.Status != null || u.ClearPrice))
            return (null, "אי אפשר לפרסם מוצר בלי מחיר חיובי. קבעו מחיר או הסתירו את המוצר.");

        p.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        var saleChanged = before.SaleOpensAt != p.SaleOpensAt || before.ShowBeforeSale != p.ShowBeforeSale || before.SalePaused != p.SalePaused;
        await AuditAsync(admin, before.PriceIls != p.PriceIls || before.PreviousPriceIls != p.PreviousPriceIls ? "product-price-changed" : saleChanged ? "product-sale-changed" : "product-updated", "product", p.Id, new
        {
            before,
            after = new { p.Name, p.PriceIls, p.PreviousPriceIls, Status = p.Status.ToString(), p.MaxPlayers, p.CoverImage, p.SaleOpensAt, p.ShowBeforeSale, p.SalePaused },
        });
        return (ProductRow(p), null);
    }

    // ------------------------------------------------------------------ free admin game

    /// <summary>
    /// Opens a group game for the admin without payment (spec §15): an AdminFree entitlement and a room,
    /// no order, no revenue. Players invited to it get no ownership or entitlement of their own.
    /// </summary>
    /// <summary>
    /// Opens a room of any playable game without payment, however many the admin wants, also while its sale is paused.
    /// It creates no order and never reaches the payment provider. The room and its log entry are saved together.
    /// </summary>
    public async Task<(OpenedGame? Game, string? ProductName, string? Error)> OpenFreeGameAsync(string productId, string admin)
    {
        var product = await db.Products.AsNoTracking().FirstOrDefaultAsync(p => p.Id == productId);
        if (product == null) return (null, null, "המשחק לא נמצא.");
        if (!PurchaseService.IsPlayable(product, scenarios)) return (null, null, "תוכן המשחק הזה עדיין לא קיים בשרת.");
        var now = DateTime.UtcNow;
        var ent = new Entitlement
        {
            Id = Guid.NewGuid(), ProductId = product.Id, Source = EntitlementSource.AdminFree,
            SessionsAllowed = 1, SessionsUsed = 1, IsTest = false, CreatedAt = now,
        };
        db.Entitlements.Add(ent);
        var (room, claim) = await rooms.CreateRoomAsync(product.ScenarioId!, r =>
        {
            r.ProductId = product.Id;
            r.MaxPlayers = rooms.Engine.MaxPlayersFor(product.MaxPlayers);
            r.EntitlementId = ent.Id;
            r.AccessSource = "admin-free";
            db.AdminAuditLog.Add(new AdminAuditLog
            {
                AdminName = admin, Action = "free-game-opened", TargetType = "game", TargetId = r.Code,
                DetailsJson = JsonSerializer.Serialize(new { productId = product.Id, productName = product.Name, code = r.Code }), CreatedAt = now,
            });
        });
        return (new OpenedGame(room.Code, claim, false), product.Name, null);
    }

    /// <summary>A new host claim for a room the admin opened, while it is still in the lobby.</summary>
    public async Task<(OpenedGame? Game, string? Error)> ReclaimFreeGameAsync(string code)
    {
        var room = await db.Rooms.FirstOrDefaultAsync(r => r.Code == RoomService.NormalizeCode(code) && r.AccessSource == "admin-free");
        if (room == null) return (null, "המשחק לא נמצא.");
        if (room.Phase != RoomPhase.Lobby) return (new OpenedGame(room.Code, null, true), null);
        var claim = RoomService.NewToken();
        room.HostClaimHash = RoomService.Hash(claim);
        room.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        return (new OpenedGame(room.Code, claim, true), null);
    }

    public async Task<object> AuditListAsync() =>
        (await db.AdminAuditLog.AsNoTracking().OrderByDescending(a => a.Id).Take(300).ToListAsync())
            .Select(a => new { a.Id, a.AdminName, a.Action, a.TargetType, a.TargetId, details = System.Text.Json.Nodes.JsonNode.Parse(a.DetailsJson), a.CreatedAt });
}
