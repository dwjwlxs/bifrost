#!/bin/sh
set -eu

# ===================== 配置区：在这里配置需要清理的目录 =====================
# 目录路径 相对于【脚本执行目录】（即你运行 sh scripts/clean_mod.sh 时所在的目录）
# 多个目录用空格分隔，路径中不能含空格
CLEAN_DIRS="./cli ./core ./framework \
    ./plugins/compat ./plugins/governance ./plugins/jsonparser \
    ./plugins/logging ./plugins/maxim ./plugins/mocker \
    ./plugins/otel ./plugins/prompts ./plugins/semanticcache \
    ./plugins/telemetry ./transports"
# 如需添加更多目录，在上面的字符串末尾以空格追加即可
# ==========================================================================

# 清理单个 go.mod（内部工具函数）
clean_single_mod() {
    local dir="$1"
    local mod_file="${dir}/go.mod"
    local backup_file="${mod_file}.bak"
    local sum_file="${dir}/go.sum"
    local backup_sum_file="${sum_file}.bak"

    if [ ! -f "$mod_file" ]; then
        echo "⚠️  跳过：$mod_file 不存在"
        return
    fi
    if [ ! -f "$sum_file" ]; then
        echo "⚠️  跳过：$sum_file 不存在"
        return
    fi

    echo "----------------------------------------"
    echo "🔧 处理目录：$dir"
    echo "📝 备份：$backup_file"
    cp -f "$mod_file" "$backup_file"
    echo "📝 备份：$backup_sum_file"
    cp -f "$sum_file" "$backup_sum_file"

    echo "🧹 清理 replace 指令..."
    local tmp_file
    tmp_file="${mod_file}.clean.tmp"
    sed \
        -e '/^replace (/ ,/^)/d' \
        -e '/^replace /d' \
        "$mod_file" > "$tmp_file"
    cp -f "$tmp_file" "$mod_file"
    rm -f "$tmp_file"
    echo "✅ 完成：$mod_file"
}

# 还原单个 go.mod（内部工具函数）
restore_single_mod() {
    local dir="$1"
    local mod_file="${dir}/go.mod"
    local backup_file="${mod_file}.bak"
    local sum_file="${dir}/go.sum"
    local backup_sum_file="${sum_file}.bak"

    if [ ! -f "$backup_file" ]; then
        echo "⚠️  跳过：$backup_file 不存在"
        return
    fi
    if [ ! -f "$backup_sum_file" ]; then
        echo "⚠️  跳过：$backup_sum_file 不存在"
        return
    fi

    echo "----------------------------------------"
    echo "🔄 还原目录：$dir"
    cp -f "$backup_file" "$mod_file"
    rm -f "$backup_file"

    cp -f "$backup_sum_file" "$sum_file"
    rm -f "$backup_sum_file"
    echo "✅ 已从备份恢复：$mod_file 和 $sum_file"
}

# 清理所有配置目录的 go.mod
clean_mod() {
    echo "🚀 开始批量清理 go.mod replace 指令"
    echo "📂 待清理目录：$CLEAN_DIRS"
    echo ""

    for dir in $CLEAN_DIRS; do
        clean_single_mod "$dir"
    done

    echo ""
    echo "🎉 所有目录清理完成！"
    echo "如需批量还原：sh $0 restore"
}

# 还原所有配置目录的 go.mod
restore_mod() {
    echo "🔄 开始批量还原 go.mod"
    echo "📂 待还原目录：$CLEAN_DIRS"
    echo ""

    for dir in $CLEAN_DIRS; do
        restore_single_mod "$dir"
    done

    echo ""
    echo "🎉 所有目录还原完成！"
}

# ===================== 主入口 =====================
case "${1:-}" in
    clean)
        clean_mod
        ;;
    restore)
        restore_mod
        ;;
    *)
        echo "使用方法："
        echo "  清理：sh $0 clean"
        echo "  还原：sh $0 restore"
        echo ""
        echo "可在脚本内配置 CLEAN_DIRS 变量（空格分隔）指定需要清理的目录"
        exit 1
        ;;
esac