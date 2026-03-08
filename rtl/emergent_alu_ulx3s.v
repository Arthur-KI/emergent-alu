// ============================================================
//  Emergente ALU · ULX3S 85K · ECP5
//  MASK → XOR → MOD · 8 Operationen · Spike-Muster auf LEDs
//
//  Bewährte Parameter (aus React-Simulation):
//    gainA = 1.05 ≈ 17/16   gainB = 1.10 ≈ 9/8
//    xorA  = 12              xorB  = 20
//    maskA = 3 (→ AND 0x07)  maskB = 5 (→ AND 0x1F)
//
//  OpCodes (8-Bit, 28/28 trennbar ✓):
//    ADD=1  SUB=78  XOR=60  AND=83  OR=15  SHL=17  SHR=82  ADC=74
//
//  Bedienung:
//    btn[1]  ← vorherige Operation
//    btn[2]  → nächste Operation
//    btn[0]  ▶ Berechnung starten (256 Schritte)
//
//  LED-Anzeige:
//    IDLE:  led[7:5]=op_sel binär,  led[4:0]=letztes Ergebnis
//    RUN:   led zeigt Fortschritt (Lauflicht)
//    DONE:  led[7:0] = Spike-Fenster-Muster (8×16 Schritte)
//           Jedes Bit = hatte dieses 16-Schritte-Fenster einen Spike?
//           → ADD, SUB, XOR... zeigen VERSCHIEDENE Muster!
//
//  IceStudio: Code-Block einfügen, Board = ULX3S 85F
// ============================================================

`default_nettype none

module emergent_alu (
    input  wire        clk_25mhz,
    input  wire [6:0]  btn,          // active-high
    output reg  [7:0]  led
);

// ── Takt-Teiler (25MHz → ~24kHz tick) ────────────────────────
reg [9:0] div_cnt;
wire      tick = (div_cnt == 10'd0);
always @(posedge clk_25mhz)
    div_cnt <= div_cnt + 1'd1;

// ── Button-Flanken-Erkennung ──────────────────────────────────
reg  [6:0] btn_prev;
wire [6:0] btn_rise = btn & ~btn_prev;
always @(posedge clk_25mhz)
    if (tick) btn_prev <= btn;

// ── Operationsauswahl ─────────────────────────────────────────
// 8 OpCodes aus der Simulation (8-Bit, 28/28 ✓)
reg [2:0] op_sel;

function signed [7:0] get_amp;
    input [2:0] sel;
    case (sel)
        3'd0: get_amp =  8'sd1;   // ADD
        3'd1: get_amp =  8'sd78;  // SUB
        3'd2: get_amp =  8'sd60;  // XOR
        3'd3: get_amp =  8'sd83;  // AND
        3'd4: get_amp =  8'sd15;  // OR
        3'd5: get_amp =  8'sd17;  // SHL
        3'd6: get_amp =  8'sd82;  // SHR
        3'd7: get_amp =  8'sd74;  // ADC
    endcase
endfunction

wire signed [7:0]  amp    = get_amp(op_sel);
wire signed [15:0] amp16  = {{8{amp[7]}}, amp};

// ── Zustandsmaschine ──────────────────────────────────────────
localparam IDLE = 2'd0, RUN = 2'd1, DONE = 2'd2;
reg  [1:0] state;
reg  [8:0] step;     // 0..255

// ── ALU-Register (16-Bit für Zwischenrechnung) ────────────────
// MASK→XOR→MOD läuft als KETTE in einem Takt
// a1, a2, a3 = Zustand der 3 Stufen, getrennt für Unit A und B
reg signed [15:0] a1A, a2A, a3A;
reg signed [15:0] a1B, a2B, a3B;
reg signed [15:0] pC;           // vorheriger yC (für Spike-Detektion)

// ── Spike-Fenster (8 Fenster × 16 Schritte) ──────────────────
reg [7:0] spike_win;

// ═══════════════════════════════════════════════════════════════
//  Kombinatorische Pipeline · eine Stufe pro Takt-Schritt
//  (alle Berechnungen passieren innerhalb eines Taktes)
// ═══════════════════════════════════════════════════════════════

// ── Stufe 1: maskN(gainA * a1 + amp) ─────────────────────────
//   gainA = 17/16:  x + (x >> 4)
//   gainB = 9/8:    x + (x >> 3)
wire signed [15:0] g_a1A = a1A + (a1A >>> 4);
wire signed [15:0] g_a1B = a1B + (a1B >>> 3);
wire signed [15:0] s1A   = g_a1A + amp16;
wire signed [15:0] s1B   = g_a1B + amp16;
//   maskA=3 → AND 0x07,  maskB=5 → AND 0x1F  (immer positiv < HALF)
wire signed [15:0] na1A  = {8'h00, s1A[7:0] & 8'h07};
wire signed [15:0] na1B  = {8'h00, s1B[7:0] & 8'h1F};

// ── Stufe 2: xorN(gainA * a2 + na1, xorK) ────────────────────
//   na1 (Ausgabe Stufe 1) fließt DIREKT in Stufe 2 (Kette!)
wire signed [15:0] g_a2A = a2A + (a2A >>> 4);
wire signed [15:0] g_a2B = a2B + (a2B >>> 3);
wire signed [15:0] s2A   = g_a2A + na1A;   // ← na1A aus Stufe 1
wire signed [15:0] s2B   = g_a2B + na1B;
//   XOR mit Konstante, dann als vorzeichenbehaftet interpretieren
wire [7:0]         x2A_u = s2A[7:0] ^ 8'd12;   // xorA=12
wire [7:0]         x2B_u = s2B[7:0] ^ 8'd20;   // xorB=20
wire signed [15:0] na2A  = {{8{x2A_u[7]}}, x2A_u};
wire signed [15:0] na2B  = {{8{x2B_u[7]}}, x2B_u};

// ── Stufe 3: modN(gainA * a3 + na2) ──────────────────────────
//   na2 (Ausgabe Stufe 2) fließt DIREKT in Stufe 3 (Kette!)
wire signed [15:0] g_a3A = a3A + (a3A >>> 4);
wire signed [15:0] g_a3B = a3B + (a3B >>> 3);
wire signed [15:0] s3A   = g_a3A + na2A;   // ← na2A aus Stufe 2
wire signed [15:0] s3B   = g_a3B + na2B;
//   modN = untere 8 Bits vorzeichenbehaftet interpretieren
//   (natürlicher 8-Bit Overflow = Modulo 256, zentriert bei 0)
wire signed [15:0] na3A  = {{8{s3A[7]}}, s3A[7:0]};
wire signed [15:0] na3B  = {{8{s3B[7]}}, s3B[7:0]};

// ── Ausgabe: yA = modN(na3 + amp), yC = modN(yA + yB) ────────
wire signed [15:0] yA_r  = na3A + amp16;
wire signed [15:0] yA    = {{8{yA_r[7]}}, yA_r[7:0]};
wire signed [15:0] yB_r  = na3B + amp16;
wire signed [15:0] yB    = {{8{yB_r[7]}}, yB_r[7:0]};
wire signed [15:0] yC_r  = yA + yB;
wire signed [15:0] yC    = {{8{yC_r[7]}}, yC_r[7:0]};

// ── Spike-Detektion: |yC - pC| >= 77  (= 256 × 0.3) ─────────
wire signed [15:0] spike_diff = yC - pC;
wire               is_spike   = (spike_diff > 16'sd77) |
                                (spike_diff < -16'sd77);

// Welches 16er-Fenster? step[6:4] = Fenster 0..7 bei step 0..127
wire [2:0] window = step[6:4];

// ═══════════════════════════════════════════════════════════════
//  Haupt-FSM
// ═══════════════════════════════════════════════════════════════
always @(posedge clk_25mhz) begin
    if (tick) begin
        case (state)

            IDLE: begin
                // Op-Navigation
                if (btn_rise[2]) op_sel <= op_sel + 3'd1; // →
                if (btn_rise[1]) op_sel <= op_sel - 3'd1; // ←

                // Start-Button: Berechnung starten
                if (btn_rise[0]) begin
                    state    <= RUN;
                    step     <= 9'd0;
                    a1A <= 0; a2A <= 0; a3A <= 0;
                    a1B <= 0; a2B <= 0; a3B <= 0;
                    pC  <= 0;
                    spike_win <= 8'd0;
                end

                // LED: op_sel oben, letztes Ergebnis unten
                led <= {1'b0, op_sel, led[4:0]};  // zeige op_sel in [6:4]
            end

            RUN: begin
                // Register updaten (Kette: na1→a1, na2→a2, na3→a3)
                a1A <= na1A;  a2A <= na2A;  a3A <= na3A;
                a1B <= na1B;  a2B <= na2B;  a3B <= na3B;
                pC  <= yC;

                // Spike in Fenster registrieren (nur erste 128 Schritte)
                if (is_spike && step < 9'd128)
                    spike_win[window] <= 1'b1;

                // Fortschritts-Lauflicht auf LEDs
                led <= (8'd1 << step[7:5]);  // 8 Phasen

                step <= step + 9'd1;

                if (step == 9'd255) begin
                    state <= DONE;
                    led   <= spike_win;  // Ergebnis anzeigen
                end
            end

            DONE: begin
                // Ergebnis auf LEDs halten
                led <= spike_win;
                // Beliebiger Button → zurück zu IDLE
                if (|btn_rise) state <= IDLE;
            end

        endcase
    end
end

endmodule
