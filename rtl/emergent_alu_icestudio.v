// AUTO-DEMO: läuft alle 8 Ops durch, zeigt je 3 Sek Ergebnis
// led_0..2 = welche Op gerade (binär 000..111)
// led_3..7 = spike_win Ergebnis der Op
reg [16:0] div_cnt = 17'd0;
wire tick = (div_cnt == 17'd0);  // ~5ms
// ── Button Reset ──────────────────────────────────────────────
reg btn_meta=0, btn_sync=0, btn_prev=0;
wire btn_rise = btn_sync & ~btn_prev;
reg [2:0] op_sel = 3'd0;
function signed [7:0] get_amp;
    input [2:0] sel;
    case (sel)
        3'd0: get_amp =  8'sd1;
        3'd1: get_amp =  8'sd78;
        3'd2: get_amp =  8'sd60;
        3'd3: get_amp =  8'sd83;
        3'd4: get_amp =  8'sd15;
        3'd5: get_amp =  8'sd17;
        3'd6: get_amp =  8'sd82;
        3'd7: get_amp =  8'sd74;
    endcase
endfunction
wire signed  [7:0] amp   = get_amp(op_sel);
wire signed [15:0] amp16 = {{8{amp[7]}}, amp};
localparam IDLE=2'd0, RUN=2'd1, SHOW=2'd2;
reg  [1:0] state = IDLE;
reg  [8:0] step  = 9'd0;
reg [9:0]  show_cnt = 10'd0;
reg signed [15:0] a1A=0,a2A=0,a3A=0,a1B=0,a2B=0,a3B=0,pC=0;
reg  [7:0] spike_win = 8'd0;
reg  [7:0] r_led     = 8'd0;
wire signed [15:0] s1A  = a1A+(a1A>>>4)+amp16;
wire signed [15:0] s1B  = a1B+(a1B>>>3)+amp16;
wire signed [15:0] na1A = {8'h00, s1A[7:0] & 8'h07};
wire signed [15:0] na1B = {8'h00, s1B[7:0] & 8'h1F};
wire signed [15:0] s2A  = a2A+(a2A>>>4)+na1A;
wire signed [15:0] s2B  = a2B+(a2B>>>3)+na1B;
wire [7:0]         x2A  = s2A[7:0] ^ 8'd12;
wire [7:0]         x2B  = s2B[7:0] ^ 8'd20;
wire signed [15:0] na2A = {{8{x2A[7]}}, x2A};
wire signed [15:0] na2B = {{8{x2B[7]}}, x2B};
wire signed [15:0] s3A  = a3A+(a3A>>>4)+na2A;
wire signed [15:0] s3B  = a3B+(a3B>>>3)+na2B;
wire signed [15:0] na3A = {{8{s3A[7]}}, s3A[7:0]};
wire signed [15:0] na3B = {{8{s3B[7]}}, s3B[7:0]};
wire signed [15:0] yCs  = na3A+amp16+na3B+amp16;
wire signed [15:0] yC   = {{8{yCs[7]}}, yCs[7:0]};
wire signed [15:0] sdiff    = yC - pC;
wire               is_spike = (sdiff>16'sd77)|(sdiff<-16'sd77);
wire [2:0]         window   = step[6:4];
always @(posedge clk_25mhz) begin
    div_cnt  <= div_cnt + 17'd1;
    btn_meta <= btn_0;
    btn_sync <= btn_meta;
    if (tick) begin
        btn_prev <= btn_sync;
        if (btn_rise) begin
            op_sel <= 3'd0;
            state  <= IDLE;
        end else
        case (state)
            IDLE: begin
                a1A<=0;a2A<=0;a3A<=0;
                a1B<=0;a2B<=0;a3B<=0;
                pC<=0; spike_win<=8'd0; step<=9'd0;
                state <= RUN;
                r_led <= ~{5'b11111, op_sel};
            end
            RUN: begin
                a1A<=na1A;a2A<=na2A;a3A<=na3A;
                a1B<=na1B;a2B<=na2B;a3B<=na3B;
                pC<=yC;
                if (is_spike && step<9'd128)
                    spike_win[window]<=1'b1;
                step <= step + 9'd1;
                if (step==9'd255) begin
                    state    <= SHOW;
                    show_cnt <= 10'd0;
                    r_led <= {spike_win[4:0], op_sel};
                end
            end
            SHOW: begin
                show_cnt <= show_cnt + 10'd1;
                if (show_cnt == 10'd600) begin
                    op_sel <= op_sel + 3'd1;
                    state  <= IDLE;
                end
            end
        endcase
        end
    end
assign led_0 = ~r_led[0];
assign led_1 = ~r_led[1];
assign led_2 = ~r_led[2];
assign led_3 = ~r_led[3];
assign led_4 = ~r_led[4];
assign led_5 = ~r_led[5];
assign led_6 = ~r_led[6];
assign led_7 = ~r_led[7];
