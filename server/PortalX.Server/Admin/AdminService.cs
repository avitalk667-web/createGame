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

public sealed record ProductUpdate(string? Name, string? Tagline, string? Description, string? CoverImage, decimal? PriceIls,
    bool ClearPrice, string? Status, int? MaxPlayers);

/// <summary>
/// Admin reports and actions. Revenue counts only confirmed, non-test payments; admin free games never count
/// as revenue or as paid games. Nothing here returns payment card data (none is stored).
/// </summary>
public sealed class AdminService(PortalDbContext db, ScenarioCatalog scenarios, RoomService rooms, ILogger<AdminService> logger)
{
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

    /// <summary>Rooms opened through purchases or admin free games (plus legacy rooms only when no product filter is set).</summary>
    private async Task<List<RoomRow>> RoomsAsync(AdminFilter f)
    {
        var q = db.Rooms.AsNoTracking();
        if (f.From is { } from) q = q.Where(r => r.CreatedAt >= from);
        if (f.To is { } to) q = q.Where(r => r.CreatedAt < to);
        if (f.ProductId != null) q = q.Where(r => r.ProductId == f.ProductId);
        if (f.Access != null) q = q.Where(r => r.AccessSource == f.Access);
        if (f.Search != null) q = q.Where(r => r.Code == RoomService.NormalizeCode(f.Search));
        var list = await q.OrderByDescending(r => r.CreatedAt).Take(1000).ToListAsync();
        var ids = list.Select(r => r.Id).ToList();
        var entIds = list.Where(r => r.EntitlementId != null).Select(r => r.EntitlementId!.Value).ToList();
        var ents = await db.Entitlements.AsNoTracking().Where(e => entIds.Contains(e.Id)).ToDictionaryAsync(e => e.Id);
        var orderIds = ents.Values.Where(e => e.OrderId != null).Select(e => e.OrderId!.Value).ToList();
        var orders = await db.Orders.AsNoTracking().Where(o => orderIds.Contains(o.Id)).ToDictionaryAsync(o => o.Id);
        var players = await db.Players.AsNoTracking().Where(p => ids.Contains(p.RoomId) && !p.IsRemoved)
            .GroupBy(p => p.RoomId).Select(g => new { g.Key, Count = g.Count() }).ToDictionaryAsync(x => x.Key, x => x.Count);
        var results = (await db.Results.AsNoTracking().Where(r => ids.Contains(r.RoomId)).ToListAsync())
            .GroupBy(r => r.RoomId).ToDictionary(g => g.Key, g => g.OrderByDescending(r => r.CreatedAt).First());
        var rows = list.Select(r =>
        {
            var ent = r.EntitlementId is { } eid && ents.TryGetValue(eid, out var e) ? e : null;
            var order = ent?.OrderId is { } oid && orders.TryGetValue(oid, out var o) ? o : null;
            return new RoomRow(r, ent, order, players.GetValueOrDefault(r.Id), results.GetValueOrDefault(r.Id));
        });
        if (!f.IncludeTest) rows = rows.Where(x => x.Ent?.IsTest != true);
        return rows.ToList();
    }

    private static bool Started(RoomRow r) => r.Room.Phase != RoomPhase.Lobby || r.Result != null;
    private static bool Completed(RoomRow r) => r.Room.Phase == RoomPhase.Completed || r.Result is { CompletionType: "success" };
    private static string GameStatus(RoomRow r) => Completed(r) ? "completed" : Started(r) ? "in-progress" : "not-started";

    public async Task<object> DashboardAsync(AdminFilter f)
    {
        var orders = await Orders(f with { Status = null, Search = null }).ToListAsync();
        var confirmed = orders.Where(o => o.Status is OrderStatus.Paid or OrderStatus.Refunded).ToList();
        var refunded = orders.Where(o => o.Status == OrderStatus.Refunded).ToList();
        var roomRows = await RoomsAsync(f with { Status = null, Search = null, Access = null });
        var managed = roomRows.Where(r => r.Room.AccessSource is "purchase" or "admin-free").ToList();
        var paidRooms = managed.Where(r => r.Room.AccessSource == "purchase").ToList();
        var freeRooms = managed.Where(r => r.Room.AccessSource == "admin-free").ToList();
        // free trial games: shown separately, never part of the revenue or of the paid games
        var sampleRooms = roomRows.Where(r => r.Room.AccessSource == "free-sample").ToList();
        var paidWithRoom = paidRooms.Where(r => r.Order != null).Select(r => r.Order!.Id).ToHashSet();
        var products = await db.Products.AsNoTracking().OrderBy(p => p.SortOrder).ToListAsync();

        object Money(IEnumerable<Order> conf, IEnumerable<Order> refs)
        {
            var gross = conf.Sum(o => o.PriceSnapshot);
            var refunds = refs.Sum(o => o.RefundedAmount ?? o.PriceSnapshot);
            return new { gross, refunds, afterRefunds = gross - refunds, paidCount = conf.Count(), refundCount = refs.Count() };
        }

        return new
        {
            currency = "ILS",
            includesTest = f.IncludeTest,
            revenue = Money(confirmed, refunded),
            byProduct = products.Where(p => f.ProductId == null || p.Id == f.ProductId).Select(p => new
            {
                productId = p.Id, name = p.Name, p.IsFree,
                // a free game has no sales: its money is always zero and its games are the free trial runs
                money = p.IsFree ? Money([], []) : Money(confirmed.Where(o => o.ProductId == p.Id), refunded.Where(o => o.ProductId == p.Id)),
                games = p.IsFree ? sampleRooms.Count(r => r.Room.ProductId == p.Id) : managed.Count(r => r.Room.ProductId == p.Id),
            }),
            freeGame = await FreeGameReportAsync(sampleRooms, products.FirstOrDefault(p => p.IsFree)),
            buyersWithEmail = confirmed.Where(o => o.Email != null).Select(o => o.Email!.ToLowerInvariant()).Distinct().Count(),
            orders = new
            {
                pending = orders.Count(o => o.Status == OrderStatus.Pending),
                failed = orders.Count(o => o.Status == OrderStatus.Failed),
                cancelled = orders.Count(o => o.Status == OrderStatus.Cancelled),
            },
            games = new
            {
                opened = managed.Count,
                started = managed.Count(Started),
                completed = managed.Count(Completed),
                paidStarted = paidRooms.Count(Started),
                adminFree = freeRooms.Count,
                adminFreeStarted = freeRooms.Count(Started),
                freeSample = sampleRooms.Count,
                freeSampleStarted = sampleRooms.Count(Started),
                freeSampleCompleted = sampleRooms.Count(Completed),
                freeSamplePlayers = sampleRooms.Sum(r => r.Players),
                // paid but not started: a room still in the lobby, or a paid order whose game was never opened
                purchasedNotStarted = paidRooms.Count(r => !Started(r))
                    + confirmed.Count(o => o.Status == OrderStatus.Paid && !paidWithRoom.Contains(o.Id)),
            },
            // without customer accounts a person is counted once per game they joined (a reconnect keeps the same seat)
            participants = managed.Sum(r => r.Players),
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
    private async Task<object?> FreeGameReportAsync(List<RoomRow> sampleRooms, Product? product)
    {
        if (product == null) return null;
        var rows = sampleRooms.Where(r => r.Room.ProductId == product.Id || r.Room.ScenarioId == product.ScenarioId).ToList();
        var ids = rows.Select(r => r.Room.Id).ToList();
        var startedIds = rows.Where(Started).Select(r => r.Room.Id).ToHashSet();
        // everyone who took a seat, also players who later left the game
        var seats = await db.Players.AsNoTracking().Where(p => ids.Contains(p.RoomId)).Select(p => new { p.Id, p.RoomId }).ToListAsync();

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
            created = rows.Count,
            started = startedIds.Count,
            notStarted = rows.Count - startedIds.Count,
            completed = rows.Count(Completed),
            participants = seats.Select(s => s.Id).Distinct().Count(),
            participantsInStarted = seats.Where(s => startedIds.Contains(s.RoomId)).Select(s => s.Id).Distinct().Count(),
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

    public async Task<object> GamesAsync(AdminFilter f)
    {
        var rows = await RoomsAsync(f);
        var names = await db.Products.AsNoTracking().ToDictionaryAsync(p => p.Id, p => p.Name);
        return rows.Select(r => new
        {
            r.Room.Code,
            productId = r.Room.ProductId,
            productName = r.Room.ProductId != null && names.TryGetValue(r.Room.ProductId, out var n) ? n : scenarios.Find(r.Room.ScenarioId)?.Name,
            access = r.Room.AccessSource,
            isTest = r.Ent?.IsTest ?? false,
            orderNumber = r.Order?.Number,
            owner = r.Room.AccessSource switch { "admin-free" => "מנהל", "free-sample" => "משחק התנסות חינמי", _ => r.Order != null ? $"הזמנה {r.Order.Number}" : null },
            r.Room.CreatedAt,
            startedAt = r.Room.IntroStartedAt ?? r.Room.StartedAt,
            r.Room.EndedAt,
            players = r.Players,
            phase = r.Room.Phase.ToString().ToLowerInvariant(),
            status = GameStatus(r),
            result = r.Result == null ? null : new
            {
                r.Result.DurationSeconds, r.Result.HintsUsed, r.Result.PuzzlesSolved, r.Result.PuzzlesTotal, r.Result.CompletionType,
            },
            groupScore = GameEngine.World(r.Room).Score?.Group,
        });
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
            p.Id, p.Name, p.Tagline, p.Description, p.CoverImage, price = p.PriceIls, p.Currency,
            status = p.Status.ToString().ToLowerInvariant(), p.MinPlayers, p.MaxPlayers, p.ScenarioId, p.UpdatedAt, p.IsFree,
            maxPlayersLimit = rooms.Engine.MaxPlayersLimit,
            playable = PurchaseService.IsPlayable(p, scenarios),
            warnings = Warnings(p),
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
        var before = new { p.Name, p.PriceIls, Status = p.Status.ToString(), p.MaxPlayers, p.CoverImage };

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
        // spec §6: a paid product cannot be published without a positive price
        if (p.Status == ProductStatus.Published && !p.IsFree && p.PriceIls is not > 0 && (u.Status != null || u.ClearPrice))
            return (null, "אי אפשר לפרסם מוצר בלי מחיר חיובי. קבעו מחיר או הסתירו את המוצר.");

        p.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        await AuditAsync(admin, before.PriceIls != p.PriceIls ? "product-price-changed" : "product-updated", "product", p.Id, new
        {
            before,
            after = new { p.Name, p.PriceIls, Status = p.Status.ToString(), p.MaxPlayers, p.CoverImage },
        });
        return (ProductRow(p), null);
    }

    // ------------------------------------------------------------------ free admin game

    /// <summary>
    /// Opens a group game for the admin without payment (spec §15): an AdminFree entitlement and a room,
    /// no order, no revenue. Players invited to it get no ownership or entitlement of their own.
    /// </summary>
    public async Task<(OpenedGame? Game, string? Error)> OpenFreeGameAsync(string productId, string admin)
    {
        var product = await db.Products.AsNoTracking().FirstOrDefaultAsync(p => p.Id == productId);
        if (product == null) return (null, "המוצר לא נמצא.");
        if (!PurchaseService.IsPlayable(product, scenarios)) return (null, "תוכן המשחק הזה עדיין לא קיים בשרת.");
        var ent = new Entitlement
        {
            Id = Guid.NewGuid(), ProductId = product.Id, Source = EntitlementSource.AdminFree,
            SessionsAllowed = 1, SessionsUsed = 1, IsTest = false, CreatedAt = DateTime.UtcNow,
        };
        db.Entitlements.Add(ent);
        var (room, claim) = await rooms.CreateRoomAsync(product.ScenarioId!, r =>
        {
            r.ProductId = product.Id;
            r.MaxPlayers = rooms.Engine.MaxPlayersFor(product.MaxPlayers);
            r.EntitlementId = ent.Id;
            r.AccessSource = "admin-free";
        });
        await AuditAsync(admin, "free-game-opened", "game", room.Code, new { productId = product.Id });
        return (new OpenedGame(room.Code, claim, false), null);
    }

    /// <summary>A new host claim for a game the admin opened, while it is still in the lobby.</summary>
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
