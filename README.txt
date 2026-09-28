TRADING AI V4 — 10 AGENTS ENGINE

Questa versione sostituisce il vecchio motore demo.

FUNZIONI
- 9 agenti indipendenti: Trend EMA, Momentum ROC, RSI, MACD, Breakout, Volatility, Volume, Mean Reversion, Structure.
- 10° modulo: RiskGuardian.
- Dati Binance reali: 200 candele 1m iniziali + WebSocket kline_1m.
- Consenso visibile BUY/SELL/WAIT e voti su 9 agenti.
- RiskGuardian con controlli su consenso, volatilità, segnali contrari e drawdown.
- Posizione demo senza ordini reali.
- Stop Loss e Take Profit automatici.
- P&L live, equity, win rate e storico persistente nel browser.
- Riconnessione WebSocket senza creare connessioni duplicate.
- Feed eventi separato dallo storico trade.
- Pulsante TEST ENGINE per verificare localmente il percorso segnali -> posizione -> TP -> P&L.

TEST
Il codice JavaScript è stato verificato con node --check.
La logica degli agenti è stata testata con serie sintetiche rialziste, ribassiste e laterali: rialzista 6/9 BUY con apertura approvata; ribassista 5/9 SELL con apertura approvata; laterale senza apertura.
L'ambiente di test non dispone di accesso Internet esterno, quindi la connessione Binance WebSocket/API non può essere verificata contro i server Binance da qui. Nel browser dell'utente viene usato l'endpoint pubblico reale.

USO
1. Mettere index.html, app.js e style.css nella root di GitHub Pages.
2. Non mantenere vecchi app.js/index.html duplicati.
3. Aprire il sito e attendere "LIVE".
4. Lasciare DEMO e premere AVVIA BOT.
5. Il bot valuta a ogni candela 1m chiusa; non forza operazioni se il mercato non soddisfa i criteri.
6. Il pulsante TEST ENGINE verifica il motore anche senza aspettare il mercato.

NESSUN ORDINE REALE viene inviato da questa versione.
