<script setup lang="ts">
import { ref } from 'vue'
import type { Track } from '../../../shared/types'
import { player, playerState } from '../core/player'
import { useLibraryStore } from '../stores/library'
import { parseCountInput, resolveCountChange } from '../utils/format'

const library = useLibraryStore()

// 行内编辑播放次数（Electron 渲染进程不支持 window.prompt）
// 注意：input[type=number] 上的 v-model 会自动把值转成 number，所以这里要兼容两种类型
const editingId = ref<string | null>(null)
const editingValue = ref<string | number>('')

// v-for 内的 template ref 会被收集为数组，这里用指令直接聚焦
const vFocus = {
  mounted(el: HTMLInputElement): void {
    el.focus()
    el.select()
  }
}

function play(track: Track): void {
  void player.play(track)
}

function editCount(track: Track): void {
  editingId.value = track.id
  editingValue.value = String(track.playCount)
}

function cancelEdit(): void {
  editingId.value = null
}

async function commitEdit(track: Track): Promise<void> {
  if (editingId.value !== track.id) return
  const next = resolveCountChange(track.playCount, parseCountInput(editingValue.value))
  editingId.value = null
  if (next === null) return
  await library.setPlayCount(track.id, next)
}
</script>

<template>
  <div class="view">
    <div class="toolbar">
      <h2>音乐库</h2>
      <button :disabled="library.loading" @click="library.importFiles()">
        {{ library.loading ? '导入中…' : '导入音频文件' }}
      </button>
    </div>

    <table v-if="library.tracks.length">
      <thead>
        <tr>
          <th>标题</th>
          <th>播放次数</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="t in library.tracks"
          :key="t.id"
          :class="{ playing: playerState.current?.id === t.id }"
        >
          <td>{{ t.title }}</td>
          <td>
            <input
              v-if="editingId === t.id"
              v-focus
              v-model="editingValue"
              class="count-input"
              type="number"
              min="0"
              @keyup.enter="commitEdit(t)"
              @keyup.esc="cancelEdit()"
              @blur="commitEdit(t)"
            />
            <span v-else>{{ t.playCount }}</span>
          </td>
          <td>
            <button class="small" @click="play(t)">播放</button>
            <button class="small ghost" @click="editCount(t)">改次数</button>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else class="empty">暂无歌曲，点击右上角「导入音频文件」开始。</p>
  </div>
</template>
