'use client';

import { useCallback, useMemo, useState } from 'react';

import useSWR from 'swr';

import { EnhancedTable, Typography } from '@rosen-bridge/ui-kit';
import { avalancheGuardAssetsReader } from '@rosen-network/avalanche';
import { fetcher } from '@rosen-ui/swr-helpers';
import type { Network } from '@rosen-ui/types';

import { useBalance } from '@/hooks';

import {
  custodyTabletHeader,
  type GuardAssetView,
  MobileRow,
  mobileHeader,
  TabletRow,
  tabletHeader,
} from './TableRow';
import { TableSkeleton } from './TableSkeleton';

const Assets = () => {
  const { data, isLoading } = useBalance();
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [coldPage, setColdPage] = useState(0);
  const [coldRowsPerPage, setColdRowsPerPage] = useState(10);
  const offset = page * rowsPerPage;
  const coldOffset = coldPage * coldRowsPerPage;
  const {
    data: response,
    error,
    isLoading: isAvalancheLoading,
  } = useSWR<unknown>(avalancheGuardAssetsReader.key(offset, rowsPerPage), fetcher, {
    keepPreviousData: false,
  });
  const {
    data: coldResponse,
    error: coldError,
    isLoading: isColdLoading,
  } = useSWR<unknown>(avalancheGuardAssetsReader.key(coldOffset, coldRowsPerPage), fetcher, {
    keepPreviousData: false,
  });
  const avalanche = useMemo(() => {
    if (isAvalancheLoading || error || response === undefined) return;
    try {
      return avalancheGuardAssetsReader.decode(response, offset, rowsPerPage);
    } catch {
      return;
    }
  }, [error, isAvalancheLoading, offset, response, rowsPerPage]);

  const avalancheCold = useMemo(() => {
    if (isColdLoading || coldError || coldResponse === undefined) return;
    try {
      return avalancheGuardAssetsReader.decode(coldResponse, coldOffset, coldRowsPerPage, 'cold');
    } catch {
      return;
    }
  }, [coldError, isColdLoading, coldOffset, coldResponse, coldRowsPerPage]);

  const items = useMemo(() => {
    if (!data) return [];

    const items = [
      ...data.cold.items.map((item) => ({ ...item, type: 'cold' })),
      ...data.hot.items.map((item) => ({ ...item, type: 'hot' })),
    ];

    const all = Object.groupBy(items, (item) => `${item.chain}:${item.balance.tokenId}`);

    return Object.values(all)
      .filter((items) => !!items)
      .map((items) => {
        const cold = items.find((item) => item.type === 'cold');

        const hot = items.find((item) => item.type === 'hot');

        const token = Object.assign({}, hot?.balance, cold?.balance, {
          chain: (cold?.chain || hot?.chain) as Network,
          amount: hot?.balance.amount || 0,
          coldAmount: cold?.balance.amount || 0,
        });

        return token;
      });
  }, [data]);

  const renderMobileRow = useCallback(
    (rowData: GuardAssetView) => (
      <MobileRow key={rowData.tokenId} {...rowData} isLoading={isLoading} />
    ),
    [isLoading],
  );

  const renderTabletRow = useCallback(
    (rowData: GuardAssetView) => (
      <TabletRow key={rowData.tokenId} {...rowData} isLoading={isLoading} />
    ),
    [isLoading],
  );

  const tableHeaderProps = useMemo(
    () => ({
      mobile: mobileHeader,
      tablet: tabletHeader,
    }),
    [],
  );

  const tableRenderRowProps = useMemo(
    () => ({
      mobile: renderMobileRow,
      tablet: renderTabletRow,
    }),
    [renderMobileRow, renderTabletRow],
  );

  const hotHeaderProps = useMemo(
    () => ({ mobile: mobileHeader, tablet: custodyTabletHeader('Hot') }),
    [],
  );
  const coldHeaderProps = useMemo(
    () => ({ mobile: mobileHeader, tablet: custodyTabletHeader('Cold') }),
    [],
  );

  return (
    <>
      {isLoading ? (
        <TableSkeleton numberOfItems={25} />
      ) : (
        data && (
          <EnhancedTable
            data={items}
            responsiveHead={tableHeaderProps}
            responsiveRenderRow={tableRenderRowProps}
            paginated={false}
          />
        )
      )}
      <Typography component="h2">Avalanche hot balances</Typography>
      {isAvalancheLoading ? (
        <TableSkeleton numberOfItems={rowsPerPage} />
      ) : (
        <EnhancedTable
          data={avalanche?.items ?? []}
          responsiveHead={hotHeaderProps}
          responsiveRenderRow={tableRenderRowProps}
          emptyPlaceholder={
            avalanche ? 'No cached Avalanche hot balances' : 'Avalanche hot balances unavailable'
          }
          paginated={avalanche !== undefined}
          tablePaginationProps={{
            count: avalanche?.total ?? -1,
            page,
            rowsPerPage,
            rowsPerPageOptions: [10, 25, 100],
            nextIconButtonProps: {
              disabled: !avalanche || offset + rowsPerPage >= avalanche.total,
            },
            onPageChange: (_event, nextPage) => setPage(nextPage),
            onRowsPerPageChange: (event) => {
              const limit = Number(event.target.value);
              if (![10, 25, 100].includes(limit)) return;
              setRowsPerPage(limit);
              setPage(0);
            },
          }}
        />
      )}
      <Typography component="h2">Avalanche cold balances</Typography>
      {isColdLoading ? (
        <TableSkeleton numberOfItems={coldRowsPerPage} />
      ) : (
        <EnhancedTable
          data={avalancheCold?.items ?? []}
          responsiveHead={coldHeaderProps}
          responsiveRenderRow={tableRenderRowProps}
          emptyPlaceholder={
            avalancheCold
              ? 'No cached Avalanche cold balances'
              : 'Avalanche cold balances unavailable'
          }
          paginated={avalancheCold !== undefined}
          tablePaginationProps={{
            count: avalancheCold?.total ?? -1,
            page: coldPage,
            rowsPerPage: coldRowsPerPage,
            rowsPerPageOptions: [10, 25, 100],
            nextIconButtonProps: {
              disabled: !avalancheCold || coldOffset + coldRowsPerPage >= avalancheCold.total,
            },
            onPageChange: (_event, nextPage) => setColdPage(nextPage),
            onRowsPerPageChange: (event) => {
              const limit = Number(event.target.value);
              if (![10, 25, 100].includes(limit)) return;
              setColdRowsPerPage(limit);
              setColdPage(0);
            },
          }}
        />
      )}
    </>
  );
};

export default Assets;
