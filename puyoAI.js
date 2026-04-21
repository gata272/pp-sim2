<button id="ai-step-button" onclick="runPuyoAI()"
        style="width: 100%; padding: 8px; border: none; border-radius: 5px; font-size: 0.85em; font-weight: bold; background-color: #f39c12; color: white; margin-top: 5px;">
    AIで1手
</button>

<button id="ai-auto-button" onclick="toggleAIAuto()"
        style="width: 100%; padding: 8px; border: none; border-radius: 5px; font-size: 0.85em; font-weight: bold; background-color: #8e44ad; color: white; margin-top: 5px;">
    AI自動: OFF
</button>

<div id="ai-status" style="font-size: 0.7em; color: #aaa; margin-top: 4px;">
    AI待機中
</div>

<script src="puyoSim.js"></script>
<script src="puyoAI.js"></script>