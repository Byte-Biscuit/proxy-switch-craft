import { Add, CleaningServices, Refresh } from "@mui/icons-material"
import {
    Alert,
    Box,
    Button,
    Card,
    CardContent,
    Chip,
    IconButton,
    Typography
} from "@mui/material"
import { useEffect, useState } from "react"

import { getCurrentTabHostname } from "./utils/browser-api"
import { t } from "./utils/i18n"

interface FailedRequest {
    url: string
    hostname: string
    responseTime?: number
    error?: string
    timestamp: number
    status?: number
}

function IndexPopup() {
    const [failedRequests, setFailedRequests] = useState<FailedRequest[]>([])
    const [loading, setLoading] = useState(true)

    const loadFailedRequests = async () => {
        try {
            const response = await chrome.runtime.sendMessage({
                action: "getFailedRequests"
            })
            setFailedRequests(response.failedRequests || [])
        } catch (error) {
            console.error("Error loading failed requests:", error)
        } finally {
            setLoading(false)
        }
    }

    const clearFailedRequests = async () => {
        try {
            await chrome.runtime.sendMessage({
                action: "clearFailedRequests"
            })
            setFailedRequests([])
            // Close the popup page
            window.close()
        } catch (error) {
            console.error("Error clearing failed requests:", error)
        }
    }

    const addToProxyRules = async (hostname: string) => {
        try {
            await chrome.runtime.sendMessage({
                action: "addToProxyRules",
                hostname: hostname
            })
            // Refresh the list
            loadFailedRequests()
        } catch (error) {
            console.error("Error adding to proxy rules:", error)
        }
    }

    const addAllToProxyRules = async () => {
        try {
            // Get all unique hostnames
            const uniqueHostnames = [
                ...new Set(failedRequests.map((request) => request.hostname))
            ]

            // Batch add to proxy rules
            for (const hostname of uniqueHostnames) {
                await chrome.runtime.sendMessage({
                    action: "addToProxyRules",
                    hostname: hostname
                })
            }

            // Refresh current tab
            chrome.tabs.query(
                {
                    active: true,
                    currentWindow: true
                },
                (tabs) => {
                    if (tabs[0]?.id) {
                        chrome.tabs.reload(tabs[0].id)
                    }
                }
            )

            // Clear failed request list
            setFailedRequests([])
        } catch (error) {
            console.error("Error adding all to proxy rules:", error)
        }
    }

    const formatTime = (timestamp: number) => {
        const date = new Date(timestamp)
        return date.toLocaleTimeString()
    }

    const formatResponseTime = (responseTime?: number) => {
        if (!responseTime) return "N/A"
        return `${responseTime}ms`
    }

    useEffect(() => {
        loadFailedRequests()
    }, [])

    if (loading) {
        return (
            <Box sx={{ p: 2, width: 400, textAlign: "center" }}>
                <Typography variant="body2">{t("loading")}</Typography>
            </Box>
        )
    }

    return (
        <Box
            sx={{
                width: 500,
                maxHeight: 600,
                display: "flex",
                flexDirection: "column"
            }}>
            <Box
                sx={{
                    p: 2,
                    borderBottom: 1,
                    borderColor: "divider",
                    flexShrink: 0
                }}>
                <Box
                    sx={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center"
                    }}>
                    <Typography variant="h6">
                        {t("networkMonitoring")}
                    </Typography>
                    <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
                        <IconButton size="small" onClick={loadFailedRequests}>
                            <Refresh />
                        </IconButton>
                        <IconButton
                            size="small"
                            onClick={clearFailedRequests}
                            sx={{ pb: 1 }}>
                            <CleaningServices sx={{ fontSize: "1.275rem" }} />
                        </IconButton>
                    </Box>
                </Box>
            </Box>

            <Box sx={{ p: 1, flex: 1 }}>
                {failedRequests.length === 0 ? (
                    <Alert severity="success">{t("noFailedRequests")}</Alert>
                ) : (
                    <>
                        <Box
                            sx={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                mb: 2
                            }}>
                            <Typography variant="body2" color="text.secondary">
                                {t("failedRequestsCount", {
                                    count: failedRequests.length.toString()
                                })}
                            </Typography>
                            <Button
                                size="small"
                                variant="contained"
                                startIcon={<Add />}
                                onClick={addAllToProxyRules}>
                                {t("addAllToProxy")}
                            </Button>
                        </Box>

                        <Box sx={{ mt: 0 }}>
                            {failedRequests.map((request, index) => (
                                <Card key={index} sx={{ mb: 1 }}>
                                    <CardContent
                                        sx={{
                                            p: 2,
                                            "&:last-child": { pb: 2 }
                                        }}>
                                        <Box
                                            sx={{
                                                display: "flex",
                                                justifyContent: "space-between",
                                                alignItems: "flex-start",
                                                mb: 1
                                            }}>
                                            <Typography
                                                variant="subtitle2"
                                                sx={{
                                                    fontWeight: "bold",
                                                    flex: 1
                                                }}>
                                                {request.hostname}
                                            </Typography>
                                            <Button
                                                size="small"
                                                variant="outlined"
                                                startIcon={<Add />}
                                                onClick={async () => {
                                                    await addToProxyRules(
                                                        request.hostname
                                                    )
                                                    chrome.tabs.query(
                                                        {
                                                            active: true,
                                                            currentWindow: true
                                                        },
                                                        (tabs) => {
                                                            if (tabs[0]?.id) {
                                                                chrome.tabs.reload(
                                                                    tabs[0].id
                                                                )
                                                            }
                                                        }
                                                    )
                                                }}
                                                sx={{ ml: 1 }}>
                                                {t("addToProxy")}
                                            </Button>
                                        </Box>

                                        <Typography
                                            variant="body2"
                                            color="text.secondary"
                                            sx={{ mb: 1 }}>
                                            {request.url}
                                        </Typography>

                                        <Box
                                            sx={{
                                                display: "flex",
                                                gap: 1,
                                                flexWrap: "wrap"
                                            }}>
                                            <Chip
                                                label={formatTime(
                                                    request.timestamp
                                                )}
                                                size="small"
                                                variant="outlined"
                                            />

                                            {request.responseTime && (
                                                <Chip
                                                    label={`${t("responseTime")}: ${formatResponseTime(request.responseTime)}`}
                                                    size="small"
                                                    color="warning"
                                                />
                                            )}

                                            {request.error && (
                                                <Chip
                                                    label={`${t("error")}: ${request.error}`}
                                                    size="small"
                                                    color="error"
                                                />
                                            )}

                                            {request.status && (
                                                <Chip
                                                    label={`${t("status")}: ${request.status}`}
                                                    size="small"
                                                    color={
                                                        request.status >= 400
                                                            ? "error"
                                                            : "default"
                                                    }
                                                />
                                            )}
                                        </Box>
                                    </CardContent>
                                </Card>
                            ))}
                        </Box>

                        <Box
                            sx={{
                                mt: 2,
                                textAlign: "center",
                                pt: 1,
                                borderTop: 1,
                                borderColor: "divider"
                            }}>
                            <Button
                                variant="outlined"
                                size="small"
                                onClick={() =>
                                    chrome.runtime.openOptionsPage()
                                }>
                                {t("openSettings")}
                            </Button>
                        </Box>
                    </>
                )}
            </Box>
        </Box>
    )
}

export default IndexPopup
