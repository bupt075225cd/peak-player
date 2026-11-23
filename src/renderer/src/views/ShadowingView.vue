<script setup lang="ts">
interface ShadowingStep {
  title: string
  points: string[]
}

// 影子跟读的五步法：逐步加难度，前两步练耳朵与理解，后三步练嘴与节奏。
// 纯展示内容，不做勾选与进度
const STEPS: ShadowingStep[] = [
  {
    title: '听两遍，先不看字幕',
    points: ['不看字幕，也不开口', '先测一下自己的听力水平，记下卡住的位置']
  },
  {
    title: '看文本，扫清障碍',
    points: ['对照原文确认生词和意思']
  },
  {
    title: '暂停式模仿',
    points: ['一句一句听，按暂停后再复刻', '每句至少重复十遍，直到能顺下来']
  },
  {
    title: '影子跟读',
    points: [
      '原速跟不上，就降到 0.8 或 0.9 倍速',
      '跟在原声后面，不要一错就停',
      '① 先别掉队，音量逐渐增大',
      '② 抓重音',
      '③ 模仿情绪',
      '④ 有问题再看看文本'
    ]
  },
  {
    title: '脱口而出',
    points: ['听到上一句，下一句能直接说出来']
  }
]
</script>

<template>
  <div class="view shadowing">
    <h2>影子跟读指南</h2>

    <p class="shadowing-intro">
      影子跟读（shadowing）是跟着原声几乎同步开口的练习：不追求一次说对，
      追求不掉队。按下面的顺序走一遍，再回头补卡住的句子。
    </p>

    <ol class="shadowing-steps">
      <li v-for="(step, index) in STEPS" :key="step.title">
        <div class="step-head">
          <span class="step-no">{{ index + 1 }}</span>
          <span class="step-title">{{ step.title }}</span>
        </div>
        <ul class="step-points">
          <li v-for="point in step.points" :key="point">{{ point }}</li>
        </ul>
      </li>
    </ol>
  </div>
</template>
