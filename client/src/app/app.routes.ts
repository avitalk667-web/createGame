import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', loadComponent: () => import('./pages/home.page').then((m) => m.HomePage), title: 'PORTAL X — בחרו את ההרפתקה שלכם' },
  { path: 'games/:id', loadComponent: () => import('./pages/game.page').then((m) => m.GamePage), title: 'פרטי המשחק — PORTAL X' },
  { path: 'checkout/:orderId', loadComponent: () => import('./pages/checkout.page').then((m) => m.CheckoutPage), title: 'הרכישה שלכם — PORTAL X' },
  { path: 'sandbox-pay/:session', loadComponent: () => import('./pages/sandbox-pay.page').then((m) => m.SandboxPayPage), title: 'תשלום בדיקה — PORTAL X' },
  { path: 'join', loadComponent: () => import('./pages/join-code.page').then((m) => m.JoinCodePage), title: 'יש לי קוד משחק — PORTAL X' },
  { path: 'join/:code', loadComponent: () => import('./pages/join.page').then((m) => m.JoinPage), title: 'הצטרפות לחדר — PORTAL X' },
  { path: 'room/:code', loadComponent: () => import('./pages/room.page').then((m) => m.RoomPage), title: 'PORTAL X — במשחק' },
  { path: 'admin/login', loadComponent: () => import('./pages/admin-login.page').then((m) => m.AdminLoginPage), title: 'כניסת מנהל — PORTAL X' },
  { path: 'admin', loadComponent: () => import('./pages/admin.page').then((m) => m.AdminPage), title: 'ניהול — PORTAL X' },
  { path: 'gallery', loadComponent: () => import('./pages/gallery.page').then((m) => m.GalleryPage), title: 'תצוגת עיצוב — PORTAL X' },
  { path: 'unsubscribe', loadComponent: () => import('./pages/unsubscribe.page').then((m) => m.UnsubscribePage), title: 'הסרה מרשימת הדיוור — PORTAL X' },
  { path: 'info/:topic', loadComponent: () => import('./pages/info.page').then((m) => m.InfoPage), title: 'מידע — PORTAL X' },
  { path: '**', redirectTo: '' },
];
