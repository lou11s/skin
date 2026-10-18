package com.teslaskin.dto;

import java.time.LocalDateTime;

/**
 * 抠图库列表项
 */
public record CutoutVO(Long id, String type, String url, LocalDateTime createdAt) {
}
