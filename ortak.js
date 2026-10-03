/* =========================================================
   Ortak kayıt — yayındaki sitenin çalışma verisini bilgisayarlar arasında eşitler.
   Kayıt, özel depodaki ayrı bir dalda (öntanımlı: ortak-kayit) JSON dosyaları olarak durur;
   GitHub Git Data API ile okunur ve yazılır. Birleştirme üç yolludur (son ortak sürüm,
   bu tarayıcı, depo): farklı fişlerde ve alanlarda yapılan değişiklikler birbirini ezmez;
   aynı alanı iki taraf farklı değiştirdiyse son eşitleyen geçer (çakışma olarak sayılır).
   Giriş sayfası (index.html) bu dosyayı yükler; Node'da tools/yayin/test altında sınanır.
   ========================================================= */
(function (kok) {
  'use strict';

  // Yalnız bu tarayıcıya ait alanlar (görünüm, seçim, geri alma yığını): depoya gitmez, birleşmez.
  var YEREL = ['updatedAt', 'selected', 'lite', 'tableWorkspace', 'v120UndoStack', 'v220ProposalUndo'];
  var KLASOR = 'ortak/';
  var KOVA = 16;           // fiş değişiklikleri 16 dosyaya bölünür; bir fişin değişmesi yalnız bir dosyayı yeniler
  var AYRI_ALAN = 30000;   // bundan büyük alanlar kendi dosyasında durur

  function duzNesne(x) { return !!x && typeof x === 'object' && !Array.isArray(x); }

  // Anahtar sırasından bağımsız derin eşitlik.
  function esit(a, b) {
    if (a === b) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a)) {
      if (a.length !== b.length) return false;
      for (var i = 0; i < a.length; i++) if (!esit(a[i], b[i])) return false;
      return true;
    }
    var ka = Object.keys(a).filter(function (k) { return a[k] !== undefined; });
    var kb = Object.keys(b).filter(function (k) { return b[k] !== undefined; });
    if (ka.length !== kb.length) return false;
    for (var j = 0; j < ka.length; j++) if (!esit(a[ka[j]], b[ka[j]])) return false;
    return true;
  }

  // Anahtarları sıralı JSON: aynı veri her zaman aynı metni verir (gereksiz commit olmaz).
  function sirala(v) {
    if (Array.isArray(v)) return v.map(sirala);
    if (!duzNesne(v)) return v;
    var o = {};
    Object.keys(v).sort().forEach(function (k) { if (v[k] !== undefined) o[k] = sirala(v[k]); });
    return o;
  }
  function kanonik(v, girinti) { return JSON.stringify(sirala(v), null, girinti); }

  // Dizi öğelerinin kimliği: fişte _uid, kayıtlarda id; ötekilerde içeriğin kendisi.
  function kimlikler(dizi) {
    var say = {};
    return dizi.map(function (x) {
      var k;
      if (duzNesne(x) && x._uid != null) k = 'u:' + x._uid;
      else if (duzNesne(x) && (typeof x.id === 'string' || typeof x.id === 'number')) k = 'i:' + x.id;
      else k = 'j:' + kanonik(x);
      var n = say[k] = (say[k] || 0) + 1;
      return n > 1 ? k + '#' + n : k;
    });
  }
  function harita(dizi, kim) { var m = Object.create(null); kim.forEach(function (k, i) { m[k] = dizi[i]; }); return m; }

  function birlestir(B, L, R, s) {
    if (esit(L, R)) return L;
    if (esit(B, L)) return R;
    if (esit(B, R)) return L;
    if (duzNesne(L) && duzNesne(R)) {
      var b = duzNesne(B) ? B : {}, out = {}, gor = Object.create(null);
      Object.keys(R).concat(Object.keys(L)).forEach(function (k) {
        if (gor[k]) return; gor[k] = 1;
        var v = birlestir(b[k], L[k], R[k], s);
        if (v !== undefined) out[k] = v;
      });
      return out;
    }
    if (Array.isArray(L) && Array.isArray(R)) return diziBirlestir(Array.isArray(B) ? B : [], L, R, s);
    if (L === undefined) return R;   // bir taraf sildi, öteki değiştirdi: değişiklik korunur
    if (R === undefined) return L;
    s.cakisma++;
    if (typeof L === 'number' && typeof R === 'number') return Math.max(L, R);
    return L;
  }

  function diziBirlestir(B, L, R, s) {
    var kb = kimlikler(B), kl = kimlikler(L), kr = kimlikler(R);
    var mB = harita(B, kb), mL = harita(L, kl), mR = harita(R, kr);
    var bas = [], orta = [], son = [], ortakGoruldu = false;
    R.forEach(function (x, i) {
      var k = kr[i];
      if (k in mL) orta.push(birlestir(mB[k], mL[k], x, s));
      else if (k in mB) { if (!esit(mB[k], x)) orta.push(x); }   // burada silindi; depoda değiştiyse kalır
      else orta.push(x);                                          // depoda eklendi
    });
    L.forEach(function (x, i) {
      var k = kl[i];
      if (k in mR) { ortakGoruldu = true; return; }
      if (k in mB) { if (!esit(mB[k], x)) (ortakGoruldu ? son : bas).push(x); return; }  // depoda silindi
      (ortakGoruldu ? son : bas).push(x);                         // burada eklendi (başa eklenenler başta kalır)
    });
    return bas.concat(orta, son);
  }

  // Paylaşılan kısım: yerel alanlar çıkarılır.
  function paylasilan(d) {
    var o = {};
    Object.keys(d || {}).forEach(function (k) { if (YEREL.indexOf(k) < 0) o[k] = d[k]; });
    return o;
  }
  // Birleşen paylaşılan veriye bu tarayıcının yerel alanları geri eklenir.
  function tamamla(ortak, yerel) {
    var o = {};
    Object.keys(ortak).forEach(function (k) { o[k] = ortak[k]; });
    YEREL.forEach(function (k) { if (yerel && yerel[k] !== undefined) o[k] = yerel[k]; });
    return o;
  }

  function kova(uid) {
    var h = 5381, t = String(uid);
    for (var i = 0; i < t.length; i++) h = ((h * 33) ^ t.charCodeAt(i)) >>> 0;
    return h % KOVA;
  }

  // Durum → depo dosyaları {yol: metin}
  function ayir(d) {
    var dosyalar = {}, genel = {}, kovalar = [];
    for (var i = 0; i < KOVA; i++) kovalar.push([]);
    Object.keys(d).forEach(function (k) {
      if (k === 'recordPatches') return;
      var metin = kanonik(d[k], 1);
      if (metin !== undefined && metin.length > AYRI_ALAN) dosyalar[KLASOR + 'alan/' + encodeURIComponent(k) + '.json'] = metin + '\n';
      else genel[k] = d[k];
    });
    dosyalar[KLASOR + 'genel.json'] = kanonik(genel, 1) + '\n';
    (d.recordPatches || []).forEach(function (r) { kovalar[kova(r && r._uid)].push(r); });
    kovalar.forEach(function (a, n) {
      if (!a.length) return;
      a.sort(function (x, y) { return String(x._uid) < String(y._uid) ? -1 : String(x._uid) > String(y._uid) ? 1 : 0; });
      dosyalar[KLASOR + 'fisler/' + (n < 10 ? '0' : '') + n + '.json'] = '[\n' + a.map(function (r) { return kanonik(r); }).join(',\n') + '\n]\n';
    });
    return dosyalar;
  }

  // Depo dosyaları → durum
  function topla(dosyalar) {
    var d = {}, fisler = [];
    Object.keys(dosyalar).forEach(function (yol) {
      var metin = typeof dosyalar[yol] === 'string' ? dosyalar[yol] : dosyalar[yol].metin;
      if (yol === KLASOR + 'genel.json') { var g = JSON.parse(metin); Object.keys(g).forEach(function (k) { d[k] = g[k]; }); }
      else if (yol.indexOf(KLASOR + 'alan/') === 0) d[decodeURIComponent(yol.slice(KLASOR.length + 5, -5))] = JSON.parse(metin);
      else if (yol.indexOf(KLASOR + 'fisler/') === 0) fisler = fisler.concat(JSON.parse(metin));
    });
    var sira = Object.create(null);
    (d.recordOrder || []).forEach(function (u, i) { sira[u] = i; });
    fisler.sort(function (a, b) {
      var x = a._uid in sira ? sira[a._uid] : 1e9, y = b._uid in sira ? sira[b._uid] : 1e9;
      return x - y;
    });
    d.recordPatches = fisler;
    return d;
  }

  /* ---------- GitHub istemcisi ---------- */
  function b64Metin(b64) {
    var ikili = atob(String(b64).replace(/\s+/g, '')), u = new Uint8Array(ikili.length);
    for (var i = 0; i < ikili.length; i++) u[i] = ikili.charCodeAt(i);
    return new TextDecoder().decode(u);
  }

  function Depo(o) {
    this.token = o.token; this.sahip = o.sahip; this.ad = o.ad; this.dal = o.dal || 'ortak-kayit';
    this.fetch = o.fetch || (typeof fetch === 'function' ? fetch.bind(kok) : null);
  }
  Depo.prototype.istek = function (yontem, yol, govde) {
    return this.fetch('https://api.github.com/repos/' + this.sahip + '/' + this.ad + yol, {
      method: yontem, cache: 'no-store',
      headers: { 'Authorization': 'Bearer ' + this.token, 'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
      body: govde ? JSON.stringify(govde) : undefined
    }).then(function (r) {
      return r.text().then(function (t) {
        var v = null; try { v = t ? JSON.parse(t) : null; } catch (e) {}
        if (r.ok) return v;
        var h = new Error('GitHub ' + r.status + (v && v.message ? ': ' + v.message : ''));
        h.durum = r.status; throw h;
      });
    });
  };
  // Dalın son hâli. Değişmemişse önbellek döner; dosyalar yalnız değiştiyse indirilir.
  Depo.prototype.oku = function (onbellek) {
    var self = this;
    return self.istek('GET', '/git/ref/heads/' + encodeURIComponent(self.dal)).then(function (ref) {
      var commit = ref.object.sha;
      if (onbellek && onbellek.commit === commit) return onbellek;
      return self.istek('GET', '/git/commits/' + commit).then(function (c) {
        return self.istek('GET', '/git/trees/' + c.tree.sha + '?recursive=1').then(function (agac) {
          var eski = (onbellek && onbellek.dosyalar) || {}, dosyalar = {};
          var isler = agac.tree.filter(function (e) { return e.type === 'blob' && e.path.indexOf(KLASOR) === 0; }).map(function (e) {
            if (eski[e.path] && eski[e.path].sha === e.sha) { dosyalar[e.path] = eski[e.path]; return null; }
            return self.istek('GET', '/git/blobs/' + e.sha).then(function (b) { dosyalar[e.path] = { sha: e.sha, metin: b64Metin(b.content) }; });
          });
          return Promise.all(isler).then(function () { return { commit: commit, agac: c.tree.sha, dosyalar: dosyalar }; });
        });
      });
    }, function (e) { if (e.durum === 404) return null; throw e; });
  };
  // Yeni commit; dal başka biri tarafından ilerletildiyse hata.cakisma = true.
  Depo.prototype.yaz = function (eski, yeni, mesaj) {
    var self = this, girdiler = [], dosyalar = {};
    var onceki = (eski && eski.dosyalar) || {};
    var isler = Object.keys(yeni).map(function (yol) {
      if (onceki[yol] && onceki[yol].metin === yeni[yol]) { dosyalar[yol] = onceki[yol]; return null; }
      return self.istek('POST', '/git/blobs', { content: yeni[yol], encoding: 'utf-8' }).then(function (b) {
        dosyalar[yol] = { sha: b.sha, metin: yeni[yol] };
        girdiler.push({ path: yol, mode: '100644', type: 'blob', sha: b.sha });
      });
    });
    Object.keys(onceki).forEach(function (yol) { if (!(yol in yeni)) girdiler.push({ path: yol, mode: '100644', type: 'blob', sha: null }); });
    return Promise.all(isler).then(function () {
      if (eski && !girdiler.length) return eski;
      girdiler.sort(function (a, b) { return a.path < b.path ? -1 : 1; });
      var agacGovde = { tree: girdiler };
      if (eski) agacGovde.base_tree = eski.agac;
      return self.istek('POST', '/git/trees', agacGovde).then(function (agac) {
        return self.istek('POST', '/git/commits', { message: mesaj, tree: agac.sha, parents: eski ? [eski.commit] : [] }).then(function (c) {
          var ilerlet = eski
            ? self.istek('PATCH', '/git/refs/heads/' + encodeURIComponent(self.dal), { sha: c.sha, force: false })
            : self.istek('POST', '/git/refs', { ref: 'refs/heads/' + self.dal, sha: c.sha });
          return ilerlet.then(function () { return { commit: c.sha, agac: agac.sha, dosyalar: dosyalar }; }, function (e) {
            if (e.durum === 422 || e.durum === 409) e.cakisma = true;
            throw e;
          });
        });
      });
    });
  };

  /* ---------- Eşitleme ----------
     o.depo, o.taban (son eşitlenen okuma: {commit, agac, dosyalar} ya da null), o.yerel (bu tarayıcının
     kaydı, nesne ya da null), o.kullanici, o.izin(yerelDegisecek) → false dönerse depoya yazmadan durur.
     Sonuç: {durum, okuma, yerelDegisti, gonderildi, cakisma, ilk} ya da {ertelendi: true}. */
  function esitle(o) {
    var s = { cakisma: 0 };
    var yerel = o.yerel ? paylasilan(o.yerel) : null;
    var izin = o.izin || function () { return true; };
    var mesaj = function (ek) { return 'Ortak kayıt: ' + (o.kullanici || 'bilinmeyen') + (ek ? ' · ' + ek : ''); };
    return o.depo.oku(o.taban).then(function (uzak) {
      if (!uzak) {
        // Dal yok: bu tarayıcının kaydı ortak kaydın başlangıcı olur.
        if (!yerel) return { durum: null, okuma: null, yerelDegisti: false, gonderildi: false, cakisma: 0 };
        if (!izin(false)) return { ertelendi: true };
        return o.depo.yaz(null, ayir(yerel), mesaj('başlangıç')).then(function (yeni) {
          return { durum: o.yerel, okuma: yeni, yerelDegisti: false, gonderildi: true, cakisma: 0, ilk: true };
        });
      }
      var uzakDurum = topla(uzak.dosyalar);
      if (!o.taban || !yerel) {
        // Bu tarayıcı ilk kez bağlanıyor: depodaki kayıt esas alınır (önceki yerel kayıt çağıran tarafından saklanır).
        var degisir = !yerel || !esit(yerel, uzakDurum);
        if (!izin(degisir)) return { ertelendi: true };
        return { durum: tamamla(uzakDurum, o.yerel), okuma: uzak, yerelDegisti: degisir, gonderildi: false, cakisma: 0 };
      }
      var tabanDurum = topla(o.taban.dosyalar);
      var birlesik = birlestir(tabanDurum, yerel, uzakDurum, s);
      var yerelDegisti = !esit(birlesik, yerel), gonder = !esit(birlesik, uzakDurum);
      if (!izin(yerelDegisti)) return { ertelendi: true };
      var yaz = gonder ? o.depo.yaz(uzak, ayir(birlesik), mesaj(s.cakisma ? s.cakisma + ' çakışma' : '')) : Promise.resolve(uzak);
      return yaz.then(function (yeni) {
        return { durum: tamamla(birlesik, o.yerel), okuma: yeni, yerelDegisti: yerelDegisti, gonderildi: gonder, cakisma: s.cakisma };
      });
    });
  }

  var api = { YEREL: YEREL, esit: esit, kanonik: kanonik, birlestir: function (B, L, R) { var s = { cakisma: 0 }; var v = birlestir(B, L, R, s); return { deger: v, cakisma: s.cakisma }; },
    paylasilan: paylasilan, tamamla: tamamla, ayir: ayir, topla: topla, Depo: Depo, esitle: esitle };
  if (typeof module === 'object' && module.exports) module.exports = api; else kok.BstOrtak = api;
})(typeof window !== 'undefined' ? window : globalThis);
