const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

let odalar = {};

const FORMASYONLAR = [
  "1-3-4-3 / 1-4-3-3", "1-3-5-2 / 1-3-6-1", "1-4-4-2 / 1-3-5-2", "1-4-5-1 / 1-5-4-1",
  "1-5-3-2 / 1-4-4-2", "1-4-2-4 / 1-4-3-3", "1-3-4-3 / 1-3-5-2", "1-4-1-4 / 1-4-5-1"
];

function desteOlustur(kisiSayisi) {
  let deste = [];
  const kl = kisiSayisi;
  const df = Math.ceil(kisiSayisi * 3.5);
  const os = Math.ceil(kisiSayisi * 4.5);
  const fv = kisiSayisi * 2;

  for(let i=0; i<kl; i++) deste.push("Kaleci");
  for(let i=0; i<df; i++) deste.push("Defans");
  for(let i=0; i<os; i++) deste.push("Orta Saha");
  for(let i=0; i<fv; i++) deste.push("Forvet");
  return deste;
}

function kartlariKaristir(dizi) {
  for (let i = dizi.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [dizi[i], dizi[j]] = [dizi[j], dizi[i]];
  }
  return dizi;
}

function kodUret() { return Math.random().toString(36).substring(2, 7).toUpperCase(); }

function zarAt() {
  return [Math.floor(Math.random() * 6) + 1, Math.floor(Math.random() * 6) + 1];
}

function siradakiOyuncuyaGec(oda) {
  let currentIndex = oda.oyuncular.findIndex(o => o.id === oda.aktifOyuncuId);
  if (currentIndex === -1) currentIndex = 0; 
  
  let oyuncuSayisi = oda.oyuncular.length;
  for (let i = 1; i <= oyuncuSayisi; i++) {
    let nextIndex = (currentIndex + i) % oyuncuSayisi;
    if (!oda.oyuncular[nextIndex].buTurMarketAldiMi) {
      oda.aktifOyuncuId = oda.oyuncular[nextIndex].id;
      return;
    }
  }
}

async function tieBreakVeSirala(oyuncular) {
  const gruplar = {};
  oyuncular.forEach(o => {
    const toplam = o.zarSonucu[0] + o.zarSonucu[1];
    if (!gruplar[toplam]) gruplar[toplam] = [];
    gruplar[toplam].push(o);
  });

  for (const toplam of Object.keys(gruplar)) {
    const grup = gruplar[toplam];
    if (grup.length > 1) {
      let deneme = 0;
      while (deneme < 10) {
        grup.forEach(o => { o.tieBreakZar = zarAt(); });
        const hepsiEsit = grup.every(
          o => (o.tieBreakZar[0] + o.tieBreakZar[1]) === (grup[0].tieBreakZar[0] + grup[0].tieBreakZar[1])
        );
        if (!hepsiEsit) break;
        deneme++;
      }
      grup.sort((a, b) => (b.tieBreakZar[0] + b.tieBreakZar[1]) - (a.tieBreakZar[0] + a.tieBreakZar[1]));
    }
  }

  return oyuncular.sort((a, b) => {
    const toplamA = a.zarSonucu[0] + a.zarSonucu[1];
    const toplamB = b.zarSonucu[0] + b.zarSonucu[1];
    if (toplamB !== toplamA) return toplamB - toplamA;
    if (a.tieBreakZar && b.tieBreakZar) {
      return (b.tieBreakZar[0] + b.tieBreakZar[1]) - (a.tieBreakZar[0] + a.tieBreakZar[1]);
    }
    return 0;
  });
}

io.on('connection', (socket) => {
  console.log('🟢 Yeni bağlantı:', socket.id);

  socket.on('odaKur', (veri) => {
    let { oyuncuIsmi, maxKapasite } = veri;
    if (maxKapasite > 8) maxKapasite = 8;
    const yeniKod = kodUret();

    odalar[yeniKod] = {
      odaKodu: yeniKod, maxKapasite, oyuncular: [], oyunBasladiMi: false,
      deste: [], marketler: [], aktifOyuncuId: null, marketAlanKisiSayisi: 0, mesajlar: []
    };

    odalar[yeniKod].oyuncular.push({
      id: socket.id, isim: oyuncuIsmi, zarSonucu: zarAt(), tieBreakZar: null,
      kendiSahasi: { Kaleci: [], Defans: [], OrtaSaha: [], Forvet: [] },
      formasyon: null, buTurMarketAldiMi: false
    });

    socket.join(yeniKod);
    socket.emit('odaKuruldu', odalar[yeniKod]);
    io.to(yeniKod).emit('lobiMesajGeldi', { gonderen: 'SİSTEM', mesaj: `👤 ${oyuncuIsmi} odayı kurdu.`, id: Math.random().toString() });
  });

  socket.on('odayaKatil', (veri) => {
    const { oyuncuIsmi, girilenKod } = veri;
    const oda = odalar[girilenKod];

    if (!oda) return socket.emit('hata', 'Oda bulunamadı!');
    if (oda.oyuncular.length >= oda.maxKapasite || oda.oyuncular.length >= 8) return socket.emit('hata', 'Oda dolu!');
    if (oda.oyunBasladiMi) return socket.emit('hata', 'Oyun zaten başlamış!');

    oda.oyuncular.push({
      id: socket.id, isim: oyuncuIsmi, zarSonucu: zarAt(), tieBreakZar: null,
      kendiSahasi: { Kaleci: [], Defans: [], OrtaSaha: [], Forvet: [] },
      formasyon: null, buTurMarketAldiMi: false
    });

    socket.join(girilenKod);
    io.to(girilenKod).emit('oyuncuKatildi', oda);
    io.to(girilenKod).emit('lobiMesajGeldi', { gonderen: 'SİSTEM', mesaj: `👋 ${oyuncuIsmi} odaya katıldı.`, id: Math.random().toString() });
  });

  socket.on('oyunuBaslat', async (odaKodu) => {
    const oda = odalar[odaKodu];
    if (!oda || oda.oyunBasladiMi) return;

    if (oda.oyuncular.length !== oda.maxKapasite) {
      return socket.emit('hata', `Oda henüz dolmadı! (Mevcut: ${oda.oyuncular.length} / Beklenen: ${oda.maxKapasite})`);
    }

    oda.oyuncular = await tieBreakVeSirala(oda.oyuncular);
    oda.aktifOyuncuId = oda.oyuncular[0].id;

    oda.deste = kartlariKaristir(desteOlustur(oda.maxKapasite));
    let karisikFormasyonlar = kartlariKaristir([...FORMASYONLAR]);
    oda.oyuncular.forEach(oyuncu => { oyuncu.formasyon = karisikFormasyonlar.pop(); });

    const gercekOyuncuSayisi = oda.oyuncular.length;
    oda.marketler = [];
    for (let i = 0; i < gercekOyuncuSayisi; i++) {
      oda.marketler.push({ id: i, kartlar: [], kilitliMi: false });
    }

    oda.oyunBasladiMi = true;
    io.to(odaKodu).emit('oyunBasladi', oda);

    const esitlikMesajlari = oda.oyuncular
      .filter(o => o.tieBreakZar)
      .map(o => `${o.isim}: tie-break ${o.tieBreakZar[0] + o.tieBreakZar[1]}`);
    if (esitlikMesajlari.length > 0) {
      io.to(odaKodu).emit('tieBreakSonucu', {
        mesaj: '🎲 Eşitlik bozuldu! Ek zar sonuçları: ' + esitlikMesajlari.join(', '),
        oyuncular: oda.oyuncular.map(o => ({ isim: o.isim, zarSonucu: o.zarSonucu, tieBreakZar: o.tieBreakZar }))
      });
    }
  });

  socket.on('lobiMesajGonder', (veri) => {
    const { odaKodu, mesaj, gonderen } = veri;
    const oda = odalar[odaKodu];
    if (!oda) return;
    io.to(odaKodu).emit('lobiMesajGeldi', { gonderen, mesaj, id: Math.random().toString() });
  });

  socket.on('mesajGonder', (veri) => {
    const { odaKodu, mesaj, gonderen } = veri;
    const oda = odalar[odaKodu];
    if (oda) {
      const yeniMesaj = { gonderen, mesaj, id: Math.random().toString() };
      oda.mesajlar.push(yeniMesaj);
      io.to(odaKodu).emit('yeniMesajGeldi', yeniMesaj);
    }
  });

  socket.on('peerIdGonder', (veri) => {
    socket.to(veri.odaKodu).emit('yeniKullaniciSeseKatildi', veri.peerId);
  });

  socket.on('kartaBak', (odaKodu) => {
    const oda = odalar[odaKodu];
    if (!oda) return;
    if (oda.aktifOyuncuId !== socket.id) return socket.emit('hata', 'Sıra sizde değil!');
    
    // Deste bittiğinde Kimse (Berabere) mesajı
    if (oda.deste.length === 0) {
      io.to(odaKodu).emit('oyunBitti', { kazanan: "Kimse (Berabere)", formasyon: "Deste Tükendi" });
      return;
    }
    
    const musaitMarketVarMi = oda.marketler.some(m => !m.kilitliMi && m.kartlar.length < 3);
    if (!musaitMarketVarMi) return socket.emit('hata', 'Tüm marketler dolu! Bir market almalısın.');
    socket.emit('kartGozuktu', oda.deste[oda.deste.length - 1]);
  });

  socket.on('kartCekVeMarketeKoy', (veri) => {
    const { odaKodu, marketId } = veri;
    const oda = odalar[odaKodu];
    if (!oda) return;
    if (oda.aktifOyuncuId !== socket.id) return socket.emit('hata', 'Sıra sizde değil!');
    if (oda.marketler[marketId].kilitliMi) return socket.emit('hata', 'Bu market alınmış, kapalı!');
    if (oda.marketler[marketId].kartlar.length >= 3) return socket.emit('hata', 'Bu market doldu (Max 3)!');

    const cekilenKart = oda.deste.pop();
    oda.marketler[marketId].kartlar.push(cekilenKart);
    siradakiOyuncuyaGec(oda);

    io.to(odaKodu).emit('masaGuncellendi', { oda: JSON.parse(JSON.stringify(oda)) });
  });

  socket.on('marketiAl', (veri) => {
    const { odaKodu, marketId } = veri;
    const oda = odalar[odaKodu];
    if (!oda) return;
    if (oda.aktifOyuncuId !== socket.id) return socket.emit('hata', 'Sıra sizde değil!');
    if (oda.marketler[marketId].kilitliMi) return socket.emit('hata', 'Bu market zaten alınmış!');
    if (oda.marketler[marketId].kartlar.length === 0) return socket.emit('hata', 'Boş marketi alamazsınız!');

    const aktifOyuncu = oda.oyuncular.find(o => o.id === socket.id);
    oda.marketler[marketId].kartlar.forEach(kart => {
      if (kart === "Kaleci") aktifOyuncu.kendiSahasi.Kaleci.push(kart);
      else if (kart === "Defans") aktifOyuncu.kendiSahasi.Defans.push(kart);
      else if (kart === "Orta Saha") aktifOyuncu.kendiSahasi.OrtaSaha.push(kart);
      else if (kart === "Forvet") aktifOyuncu.kendiSahasi.Forvet.push(kart);
    });

    oda.marketler[marketId].kartlar = [];
    oda.marketler[marketId].kilitliMi = true;
    aktifOyuncu.buTurMarketAldiMi = true;
    oda.marketAlanKisiSayisi++;

    if (oda.marketAlanKisiSayisi === oda.oyuncular.length) {
      oda.marketAlanKisiSayisi = 0;
      oda.oyuncular.forEach(o => o.buTurMarketAldiMi = false);
      oda.marketler.forEach(m => m.kilitliMi = false);
      siradakiOyuncuyaGec(oda);
      io.to(odaKodu).emit('turSifirlandi', 'Herkes market aldı, yeni tur başlıyor!');
    } else {
      siradakiOyuncuyaGec(oda);
    }

    io.to(odaKodu).emit('masaGuncellendi', { oda: JSON.parse(JSON.stringify(oda)) });
  });

  socket.on('formasyonKontrol', (odaKodu) => {
    const oda = odalar[odaKodu];
    if (!oda) return;
    const oyuncu = oda.oyuncular.find(o => o.id === socket.id);
    if (!oyuncu) return;

    let basariliMi = false;
    for (let form of oyuncu.formasyon.split(' / ')) {
      const [kaleci, defans, ortasaha, forvet] = form.split('-').map(Number);
      if (oyuncu.kendiSahasi.Kaleci.length >= kaleci && oyuncu.kendiSahasi.Defans.length >= defans &&
          oyuncu.kendiSahasi.OrtaSaha.length >= ortasaha && oyuncu.kendiSahasi.Forvet.length >= forvet) {
        basariliMi = true; break;
      }
    }
    if (basariliMi) io.to(odaKodu).emit('oyunBitti', { kazanan: oyuncu.isim, formasyon: oyuncu.formasyon });
    else socket.emit('hata', 'Formasyonun henüz tamamlanmamış!');
  });

  socket.on('disconnect', () => { 
    for (const [odaKodu, oda] of Object.entries(odalar)) {
      const index = oda.oyuncular.findIndex(o => o.id === socket.id);
      if (index !== -1) {
        const ayrilanOyuncu = oda.oyuncular[index];
        const siraOndaydi = (oda.aktifOyuncuId === socket.id);
        
        if (ayrilanOyuncu.buTurMarketAldiMi) {
          oda.marketAlanKisiSayisi = Math.max(0, oda.marketAlanKisiSayisi - 1);
        }

        oda.oyuncular.splice(index, 1);
        
        if (oda.oyuncular.length === 0) {
          delete odalar[odaKodu];
        } else {
          io.to(odaKodu).emit('lobiMesajGeldi', { gonderen: 'SİSTEM', mesaj: `🚪 ${ayrilanOyuncu.isim} odadan ayrıldı.`, id: Math.random().toString() });
          
          if (!oda.oyunBasladiMi) {
            io.to(odaKodu).emit('oyuncuKatildi', oda);
          } else {
            if (siraOndaydi) {
              let nextIndex = index % oda.oyuncular.length;
              let found = false;
              for(let i=0; i<oda.oyuncular.length; i++) {
                  let testIdx = (nextIndex + i) % oda.oyuncular.length;
                  if(!oda.oyuncular[testIdx].buTurMarketAldiMi) {
                      oda.aktifOyuncuId = oda.oyuncular[testIdx].id;
                      found = true;
                      break;
                  }
              }
              if(!found) {
                  oda.marketAlanKisiSayisi = 0;
                  oda.oyuncular.forEach(o => o.buTurMarketAldiMi = false);
                  oda.marketler.forEach(m => m.kilitliMi = false);
                  oda.aktifOyuncuId = oda.oyuncular[nextIndex].id;
                  io.to(odaKodu).emit('turSifirlandi', 'Herkes market aldı (veya oyuncu ayrıldı), yeni tur başlıyor!');
              }
            } else if (oda.marketAlanKisiSayisi === oda.oyuncular.length && oda.oyuncular.length > 0) {
                oda.marketAlanKisiSayisi = 0;
                oda.oyuncular.forEach(o => o.buTurMarketAldiMi = false);
                oda.marketler.forEach(m => m.kilitliMi = false);
                io.to(odaKodu).emit('turSifirlandi', 'Ayrılma sonrası tur tamamlandı, yeni tur başlıyor!');
            }
            io.to(odaKodu).emit('masaGuncellendi', { oda: JSON.parse(JSON.stringify(oda)) });
          }
        }
        break;
      }
    }
  });
});

server.listen(3000, () => { console.log('⚽ Scout Oyun Sunucusu Hazır! Port: 3000'); });
