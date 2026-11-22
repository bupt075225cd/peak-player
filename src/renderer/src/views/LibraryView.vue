<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Album, Track } from '../../../shared/types'
import { player, playerState } from '../core/player'
import { FILTER_ALL, FILTER_NONE, useLibraryStore } from '../stores/library'
import { parseCountInput, resolveCountChange } from '../utils/format'

const library = useLibraryStore()

// 行内编辑播放次数（Electron 渲染进程不支持 window.prompt）
// 注意：input[type=number] 上的 v-model 会自动把值转成 number，所以这里要兼容两种类型
const editingId = ref<string | null>(null)
const editingValue = ref<string | number>('')

// 新建 / 重命名专辑。渲染进程没有 prompt，输入都做成行内输入框
const albumName = ref('')
const renaming = ref(false)
const renameValue = ref('')
// 批量归入的目标专辑：'' 表示还没选
const batchTarget = ref('')

// v-for 内的 template ref 会被收集为数组，这里用指令直接聚焦
const vFocus = {
  mounted(el: HTMLInputElement): void {
    el.focus()
    el.select()
  }
}

// 当前筛选到具体专辑时才显示重命名/删除入口
const currentAlbum = computed<Album | null>(
  () => library.albums.find((a) => a.id === library.albumFilter) ?? null
)

const selectedCount = computed(() => library.selectedIds.length)
const allSelected = computed(
  () =>
    library.visibleTracks.length > 0 && library.selectedIds.length === library.visibleTracks.length
)

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

// 只从播放列表移除记录，音频/歌词/字幕文件都保留在磁盘上
async function remove(track: Track): Promise<void> {
  await library.remove(track.id)
  if (playerState.current?.id === track.id) player.stop()
}

function setFilter(e: Event): void {
  library.albumFilter = (e.target as HTMLSelectElement).value
}

// 单曲归属：下拉第一项是未分类
function setTrackAlbum(track: Track, e: Event): void {
  const value = (e.target as HTMLSelectElement).value
  void library.setAlbum([track.id], value === '' ? null : value)
}

async function createAlbum(): Promise<void> {
  const name = albumName.value.trim()
  if (!name) return
  await library.createAlbum(name)
  albumName.value = ''
}

function startRename(album: Album): void {
  renaming.value = true
  renameValue.value = album.name
}

async function submitRename(): Promise<void> {
  const album = currentAlbum.value
  if (!album) return
  await library.renameAlbum(album.id, renameValue.value)
  renaming.value = false
}

async function removeCurrentAlbum(): Promise<void> {
  const album = currentAlbum.value
  if (!album) return
  await library.deleteAlbum(album.id)
  renaming.value = false
}

function applyBatchAlbum(): void {
  const value = batchTarget.value
  if (!value) return
  void library.setAlbum([...library.selectedIds], value === FILTER_NONE ? null : value)
  batchTarget.value = ''
}

function toggleAll(): void {
  if (allSelected.value) library.clearSelection()
  else library.selectAll()
}
</script>

<template>
  <div class="view">
    <div class="toolbar">
      <h2>播放列表</h2>
      <label class="album-filter">
        专辑
        <select :value="library.albumFilter" @change="setFilter">
          <option :value="FILTER_ALL">全部（{{ library.tracks.length }}）</option>
          <option :value="FILTER_NONE">未分类</option>
          <option v-for="a in library.albums" :key="a.id" :value="a.id">
            {{ a.name }}（{{ a.trackCount }}）
          </option>
        </select>
      </label>
      <button :disabled="library.loading" @click="library.importFiles()">
        {{ library.loading ? '导入中…' : '导入音频文件' }}
      </button>
    </div>

    <div class="album-bar">
      <input
        v-model="albumName"
        class="album-input"
        type="text"
        placeholder="新专辑名称"
        @keyup.enter="createAlbum()"
      />
      <button class="small" :disabled="!albumName.trim()" @click="createAlbum()">新建专辑</button>

      <template v-if="currentAlbum">
        <template v-if="renaming">
          <input v-model="renameValue" class="album-input" type="text" @keyup.enter="submitRename()" />
          <button class="small" @click="submitRename()">保存</button>
          <button class="small ghost" @click="renaming = false">取消</button>
        </template>
        <template v-else>
          <button class="small ghost" @click="startRename(currentAlbum)">重命名</button>
          <button class="small ghost" @click="removeCurrentAlbum()">删除专辑</button>
        </template>
      </template>
    </div>

    <div v-if="selectedCount" class="batch-bar">
      <span>已选 {{ selectedCount }} 首</span>
      <label>
        归入
        <select v-model="batchTarget" @change="applyBatchAlbum">
          <option value="">选择专辑…</option>
          <option v-for="a in library.albums" :key="a.id" :value="a.id">{{ a.name }}</option>
          <option :value="FILTER_NONE">未分类</option>
        </select>
      </label>
      <button class="small ghost" @click="library.clearSelection()">清除选择</button>
    </div>

    <table v-if="library.visibleTracks.length">
      <thead>
        <tr>
          <th class="col-check">
            <input type="checkbox" :checked="allSelected" @change="toggleAll()" />
          </th>
          <th>标题</th>
          <th>专辑</th>
          <th>播放次数</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="t in library.visibleTracks"
          :key="t.id"
          :class="{ playing: playerState.current?.id === t.id }"
        >
          <td class="col-check">
            <input
              type="checkbox"
              :checked="library.selectedIds.includes(t.id)"
              @change="library.toggleSelect(t.id)"
            />
          </td>
          <td class="col-title">{{ t.title }}</td>
          <td>
            <select class="album-select" :value="t.albumId ?? ''" @change="setTrackAlbum(t, $event)">
              <option value="">未分类</option>
              <option v-for="a in library.albums" :key="a.id" :value="a.id">{{ a.name }}</option>
            </select>
          </td>
          <td class="col-count">
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
            <button class="small ghost" @click="remove(t)">删除</button>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else class="empty">
      {{
        library.tracks.length
          ? '该专辑下暂无歌曲，可通过「专辑」列或勾选后批量归入。'
          : '暂无歌曲，点击右上角「导入音频文件」开始。'
      }}
    </p>
  </div>
</template>
