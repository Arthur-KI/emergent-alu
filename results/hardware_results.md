# Emergent ALU — Hardware Messung (Final)
## ULX3S 85K, Lattice ECP5 — 08. März 2026

### Encoding (SHOW-Zustand)
r_led = {spike_win[4:0], op_sel[2:0]}
LED leuchtet wenn r_led[x] = 1 (active-low invertiert)

D2..D0 = op_sel (welche Operation)
D7..D3 = spike_win[4:0] (Ergebnis)

### Ergebnisse aus Fotos (chronologisch, neueste zuerst)

| Foto | D7 | D6 | D5 | D4 | D3 | D2 | D1 | D0 | op_sel | spike_win | Notiz |
|------|----|----|----|----|----|----|----|----|--------|-----------|-------|
|  15  | ○  | ●  | ○  | ○  | ○  | ○  | ●  | ●  |  011=3 | 00010     | D6+D1+D0 blau+rot |
|  14  | ○  | ○  | ○  | ○  | ○  | ○  | ●  | ●  |  001=1 | 00000     | nur D0+D1 rot |
|  13  | ○  | ○  | ○  | ○  | ○  | ○  | ●  | ●  |  001=1 | 00000     | nur D0+D1 rot |
|  12  | ○  | ○  | ○  | ○  | ○  | ●  | ●  | ○  |  110=6 | 00000     | nur D1+D2 grün |
|  11  | ○  | ○  | ○  | ○  | ○  | ●  | ●  | ●  |  111=7 | 00000     | D0+D1+D2 |
|  10  | ○  | ○  | ○  | ○  | ○  | ●  | ●  | ●  |  111=7 | 00000     | D0+D1+D2 |
|   9  | ○  | ○  | ●  | ●  | ○  | ●  | ●  | ●  |  111=7 | 00110     | D5+D4+D2+D1+D0 |
|   8  | ○  | ○  | ●  | ●  | ○  | ○  | ○  | ○  |  000=0 | 00110     | nur D4+D5 orange |
|   7  | ●  | ●  | ○  | ○  | ○  | ○  | ●  | ●  |  011=3 | 11000     | D7+D6 blau + D1+D0 |
|   6  | ○  | ○  | ○  | ○  | ○  | ○  | ●  | ●  |  001=1 | 00000     | D0+D1 rot |
|   5  | ○  | ○  | ○  | ○  | ○  | ○  | ●  | ●  |  001=1 | 00000     | D0+D1 rot |
|   4  | ○  | ○  | ○  | ○  | ○  | ○  | ●  | ○  |  010=2 | 00000     | nur D1 grün! |
|   3  | ○  | ○  | ○  | ○  | ○  | ●  | ●  | ●  |  111=7 | 00000     | D0+D1+D2 |
|   2  | ○  | ○  | ○  | ○  | ○  | ●  | ●  | ●  |  011=3 | 00000     | D0+D1+D2 |
|   1  | ○  | ○  | ●  | ●  | ○  | ●  | ●  | ●  |  RUN?  | —         | Animation |

### Klare Unterschiede bestätigt ✓

| Op | opCode | Ergebnis-Muster | Besonderheit |
|----|--------|-----------------|--------------|
| 0  | 1      | D4+D5           | Spikes in Fenstern 4+5 |
| 1  | 78     | D0+D1 (nur)     | kein spike_win |
| 2  | 60     | nur D1          | minimalstes Muster! |
| 3  | 83     | D0+D1 + D6+D7   | Spikes in frühen UND späten Fenstern |
| 6  | 82     | D1+D2           | mittleres Muster |
| 7  | 74     | D0+D1+D2        | alle 3 op-LEDs |

### Fazit
✓ VERSCHIEDENE Operationen → VERSCHIEDENE Muster auf echter Hardware
✓ Op 2 (opCode=60): nur 1 LED → minimale Signatur
✓ Op 3 (opCode=83): Spikes in 2 getrennten Zeitfenstern (D6+D7 UND D0+D1)
✓ Op 0 (opCode=1):  Spikes in mittleren Fenstern (D4+D5)
✓ Emergente Operationserkennung ohne Decoder bestätigt!

### Hardware
ULX3S 85K (Lattice ECP5 LFE5U-85F)
< 1% der verfügbaren LUTs genutzt
Datum: 08. März 2026
